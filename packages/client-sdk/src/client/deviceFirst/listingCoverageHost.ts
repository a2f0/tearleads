import type { DomainScope } from "../../data/shared/domainScope";
import { isReconcilableContainerNode } from "../../stores/container-contents";
import {
  getOrCreateDocumentListingCoverage,
  requestRemoteSyncsOfRecordsSavedElsewhere,
} from "../../stores/documents";
import { requestRegisteredDocumentRemoteSyncs } from "../../stores/documents/registry";
import type { LocalProjectionStore } from "../../stores/local-projection";
import type { ReconciliationHost } from "../../sync/reconciliation";
import {
  forgetUnheldDocumentListingReads,
  listOwedDocumentListingReads,
} from "../../workflows/documents";
import type { InternalRuntime } from "../runtime/workflowRuntime";

/** What the reconciler tells the scope's listing coverage, and asks of it. */
export function createListingCoverageHost(
  runtimeService: InternalRuntime,
  domainScope: DomainScope,
): Pick<
  ReconciliationHost,
  "reportDocumentLaneListed" | "requestOwedDocumentReads"
> {
  return {
    reportDocumentLaneListed: (containerId, listed) =>
      getOrCreateDocumentListingCoverage(domainScope).reportLaneListed(
        containerId,
        listed,
      ),
    requestOwedDocumentReads: async () => {
      const input = runtimeService.workflowInput();
      if (
        input.state.domainScope !== domainScope ||
        input.infra.dbStatus !== "ready"
      ) {
        return;
      }
      const { execSql } = input.infra;
      requestRegisteredDocumentRemoteSyncs(
        domainScope,
        await listOwedDocumentListingReads(execSql),
      );
      // A debt another tab already settled leaves nothing to read above, and
      // this tab's open copy of that document is still the older one.
      await requestRemoteSyncsOfRecordsSavedElsewhere(domainScope, execSql);
      // Housekeeping comes last, so its failure costs no read.
      await forgetUnheldDocumentListingReads(execSql);
    },
  };
}

/**
 * The containers whose document lanes the reconciler lists. A local-first id
 * is not listable yet and may still be racing its create request. Once
 * remote-backed, it participates normally; system contents are especially
 * important during rematerialization because this device may not have
 * authored them.
 */
export function listReconcilableContainerIds(
  runtimeService: InternalRuntime,
  store: LocalProjectionStore,
): string[] {
  const homeOrganizationId = runtimeService.workflowInput().auth.organizationId;
  return store
    .getSnapshot()
    .containers.flatMap((node) =>
      isReconcilableContainerNode(node, homeOrganizationId) ? [node.id] : [],
    );
}

/**
 * The scope's listing authority: the reconciler lists every reconcilable
 * container's document lane after each acknowledged connection, so a store
 * whose document one of them holds need not probe on its own. It answers
 * from the same list the sweep walks, rebuilt when the tree's node list is
 * replaced or the home organization changes.
 */
export function installDocumentListingAuthority(input: {
  readonly domainScope: DomainScope;
  readonly runtimeService: InternalRuntime;
  readonly store: LocalProjectionStore;
}): () => void {
  let listedFor: {
    readonly containers: ReadonlyArray<unknown>;
    readonly homeOrganizationId: unknown;
  } | null = null;
  let listedContainerIds: ReadonlySet<string> = new Set();
  return getOrCreateDocumentListingCoverage(input.domainScope).install({
    listsContainer: (containerId) => {
      const { containers } = input.store.getSnapshot();
      const homeOrganizationId =
        input.runtimeService.workflowInput().auth.organizationId;
      if (
        containers !== listedFor?.containers ||
        homeOrganizationId !== listedFor.homeOrganizationId
      ) {
        listedFor = { containers, homeOrganizationId };
        listedContainerIds = new Set(
          listReconcilableContainerIds(input.runtimeService, input.store),
        );
      }
      return listedContainerIds.has(containerId);
    },
  });
}
