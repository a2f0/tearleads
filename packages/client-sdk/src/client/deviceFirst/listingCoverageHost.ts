import type { DomainScope } from "../../data/shared/domainScope";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import {
  getOrCreateTreeCatchUp,
  isReconcilableContainerNode,
  listsHeldDocuments,
} from "../../stores/container-contents";
import {
  getOrCreateDocumentListingCoverage,
  requestRemoteSyncsOfOwedRecords,
  requestRemoteSyncsOfRecordsSavedElsewhere,
} from "../../stores/documents";
import type { LocalProjectionStore } from "../../stores/local-projection";
import type { ReconciliationHost } from "../../sync/reconciliation";
import {
  listAllContainerDocumentLanes,
  listContainerDocumentLanesFromApi,
} from "../../workflows/container-contents/documentDiscovery/containerDocumentListing";
import { forgetUnheldDocumentLaneListings } from "../../workflows/container-contents/documentDiscovery/documentLaneDiscovery";
import {
  forgetUnheldDocumentListingReads,
  type ListedDocumentHead,
  listOwedDocumentListingReads,
  oweListedRecordReads,
} from "../../workflows/documents";
import { createContainerContentsStoreRuntime } from "../containerContents";
import type { InternalRuntime } from "../runtime/workflowRuntime";

/** The scope's database, while the runtime still serves this scope. */
function scopeExecSql(
  runtimeService: InternalRuntime,
  domainScope: DomainScope,
): ExecSql | null {
  const input = runtimeService.workflowInput();
  return input.state.domainScope === domainScope &&
    input.infra.dbStatus === "ready"
    ? input.infra.execSql
    : null;
}

/** What the reconciler tells the scope's listing coverage, and asks of it. */
export function createListingCoverageHost(
  runtimeService: InternalRuntime,
  domainScope: DomainScope,
): Pick<
  ReconciliationHost,
  | "reportDocumentLaneListed"
  | "requestOwedDocumentReads"
  | "whenTreeCrawlSettles"
> {
  return {
    whenTreeCrawlSettles: () =>
      getOrCreateTreeCatchUp(domainScope).whenCrawlSettles(),
    reportDocumentLaneListed: (containerId, listed) =>
      getOrCreateDocumentListingCoverage(domainScope).reportLaneListed(
        containerId,
        listed,
      ),
    requestOwedDocumentReads: async () => {
      const execSql = scopeExecSql(runtimeService, domainScope);
      if (!execSql) return;
      requestRemoteSyncsOfOwedRecords(
        domainScope,
        await listOwedDocumentListingReads(execSql),
      );
      // A debt another tab already settled leaves nothing to read above, and
      // this tab's open copy of that document is still the older one.
      await requestRemoteSyncsOfRecordsSavedElsewhere(domainScope, execSql);
      // Housekeeping comes last, so its failure costs no read.
      await forgetUnheldDocumentListingReads(execSql);
      await forgetUnheldDocumentLaneListings(execSql);
    },
  };
}

/**
 * The initial document probe's listing: each lane from no watermark, every
 * lane in one batched listing, with each container's current document ids,
 * or `null` for a lane that could not be listed. Its rows also owe a read to
 * each record they show behind, as a watermarked listing's rows do. A
 * watermarked listing is served only the rows that moved, so this is what
 * notices, once a launch, a record whose cursor or head fell behind a row it
 * was served before (a local backup restore can replace a record's row, for
 * one). The debts are durable before each owed record's open store is asked
 * to pull; a store that opens later reads its debt when it loads. Each lane
 * owes in its own serialized mutation, skipping paused containers and any
 * listing whose probe generation was superseded meanwhile. A failure to owe
 * is logged and leaves the listing's ids as they were.
 */
export function createProbeLaneListing(
  runtimeService: InternalRuntime,
  domainScope: DomainScope,
  options?: {
    readonly isContainerPaused?: (containerId: string) => boolean;
    readonly loadSyncPauses?: (execSql: ExecSql) => Promise<void>;
  },
): ReconciliationHost["listContainerDocumentIds"] {
  return async (containerIds, listingOptions) => {
    const { apiClient } = createContainerContentsStoreRuntime(runtimeService);
    const listed = await listAllContainerDocumentLanes({
      lanes: containerIds.map((containerId) => ({
        containerId,
        watermark: null,
      })),
      // The probe settles nothing: an identical listing on its way will do.
      listContainerDocumentLanes: (lanes) =>
        listContainerDocumentLanesFromApi(apiClient, lanes, false, "mayJoin"),
    });
    const documentIds = new Map<string, ReadonlyArray<string> | null>();
    const headsByContainer = new Map<
      string,
      ReadonlyArray<ListedDocumentHead>
    >();
    for (const containerId of containerIds) {
      const lane = listed.get(containerId);
      if (!lane || lane === "unavailable") {
        documentIds.set(containerId, null);
        continue;
      }
      documentIds.set(containerId, [
        ...new Set(lane.items.map(({ id }) => id)),
      ]);
      if (lane.items.length > 0) {
        headsByContainer.set(
          containerId,
          lane.items.map((document) => ({
            accessEpoch: document.currentAccessEpoch,
            accessStateHash: document.currentAccessStateHash,
            documentId: document.id,
            updateCount: document.updateCount,
          })),
        );
      }
    }
    await oweProbedReads({
      domainScope,
      headsByContainer,
      isContainerPaused: options?.isContainerPaused,
      loadSyncPauses: options?.loadSyncPauses,
      runtimeService,
      stillCurrent: listingOptions?.stillCurrent,
    });
    return documentIds;
  };
}

async function oweProbedReads(input: {
  readonly domainScope: DomainScope;
  readonly headsByContainer: ReadonlyMap<
    string,
    ReadonlyArray<ListedDocumentHead>
  >;
  readonly isContainerPaused?: ((containerId: string) => boolean) | undefined;
  readonly loadSyncPauses?: ((execSql: ExecSql) => Promise<void>) | undefined;
  readonly runtimeService: InternalRuntime;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  const { domainScope, headsByContainer, runtimeService, stillCurrent } = input;
  const execSql = scopeExecSql(runtimeService, domainScope);
  if (!execSql || headsByContainer.size === 0 || stillCurrent?.() === false) {
    return;
  }
  const canOweContainer = (containerId: string): boolean =>
    stillCurrent?.() !== false &&
    scopeExecSql(runtimeService, domainScope) === execSql &&
    !input.isContainerPaused?.(containerId);
  try {
    await input.loadSyncPauses?.(execSql);
    for (const [containerId, heads] of headsByContainer) {
      if (!canOweContainer(containerId)) continue;
      const owed = await runSerializedSqlMutation(execSql, async (locked) =>
        canOweContainer(containerId)
          ? oweListedRecordReads(locked, heads)
          : null,
      );
      if (owed && owed.length > 0 && canOweContainer(containerId)) {
        requestRemoteSyncsOfOwedRecords(domainScope, owed);
      }
    }
  } catch (error) {
    runtimeService
      .workflowInput()
      .util.logError("Initial document probe could not owe reads", error);
  }
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
 * The containers whose listings vouch for the documents they hold: the ones
 * the reconciler lists, less a container whose lane never shows its own
 * documents (`listsHeldDocuments`). A store of a document in one of those
 * probes on its own, as every opened store did before listings owed reads.
 */
function listVouchingContainerIds(
  runtimeService: InternalRuntime,
  store: LocalProjectionStore,
): string[] {
  const homeOrganizationId = runtimeService.workflowInput().auth.organizationId;
  return store
    .getSnapshot()
    .containers.flatMap((node) =>
      isReconcilableContainerNode(node, homeOrganizationId) &&
      listsHeldDocuments(node)
        ? [node.id]
        : [],
    );
}

/**
 * The scope's listing authority: after each acknowledged connection the
 * reconciler lists every reconcilable container's document lane that moved
 * (a lane a complete tree crawl was not served did not), so a store
 * whose document one of them holds need not probe on its own. It answers
 * from the list the sweep walks, less the lanes that never show their own
 * documents, rebuilt when the tree's node list is replaced or the home
 * organization changes.
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
          listVouchingContainerIds(input.runtimeService, input.store),
        );
      }
      return listedContainerIds.has(containerId);
    },
  });
}
