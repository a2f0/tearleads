import type { DomainScope } from "../../data/shared/domainScope";
import { isReconcilableContainerNode } from "../../stores/container-contents";
import { getOrCreateDocumentListingCoverage } from "../../stores/documents";
import { requestRegisteredDocumentRemoteSyncs } from "../../stores/documents/registry";
import type { LocalProjectionStore } from "../../stores/local-projection";
import type { ReconciliationHost } from "../../sync/reconciliation";
import { listOwedDocumentListingReads } from "../../workflows/documents";
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
      requestRegisteredDocumentRemoteSyncs(
        domainScope,
        await listOwedDocumentListingReads(input.infra.execSql),
      );
    },
  };
}

/**
 * The scope's listing authority: the reconciler lists every reconcilable
 * container's document lane after each acknowledged connection, so a store
 * opened under one of them need not probe on its own. The container set is
 * rebuilt only when the tree's node list is replaced.
 */
export function installDocumentListingAuthority(input: {
  readonly domainScope: DomainScope;
  readonly runtimeService: InternalRuntime;
  readonly store: LocalProjectionStore;
}): () => void {
  let listedFor: ReadonlyArray<unknown> | null = null;
  let listedContainerIds: ReadonlySet<string> = new Set();
  return getOrCreateDocumentListingCoverage(input.domainScope).install({
    listsContainer: (containerId) => {
      const { containers } = input.store.getSnapshot();
      if (containers !== listedFor) {
        const homeOrganizationId =
          input.runtimeService.workflowInput().auth.organizationId;
        listedFor = containers;
        listedContainerIds = new Set(
          containers.flatMap((node) =>
            isReconcilableContainerNode(node, homeOrganizationId)
              ? [node.id]
              : [],
          ),
        );
      }
      return listedContainerIds.has(containerId);
    },
  });
}
