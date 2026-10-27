import type { DocumentSummary } from "../../data/documents/documentSummary";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  holdContainerDocumentTombstones,
  listKnownContainerDocumentPlacements,
  listRetryableHeldContainerDocumentTombstones,
  loadLocalDocumentAccessEpoch,
  refuteContainerDocumentTombstoneHolds,
} from "../../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { getOrCreateOrganizationSyncPauses } from "../../data/sync/organizationSyncPauses";
import { listContainerDocumentLanesFromApi } from "../../workflows/container-contents/documentDiscovery/containerDocumentListing";
import { createDiscoveredDocumentVerifier } from "../../workflows/container-contents/documentDiscovery/documentDiscoveryEvidence";
import {
  type ContainerDocumentDiscoveryLane,
  type ContainerDocumentDiscoveryOutcome,
  type ContainerDocumentDiscoveryOutcomeHandler,
  discoverContainerDocumentLanes,
} from "../../workflows/container-contents/documentDiscovery/documentDiscoveryLanes";
import { createContainerDocumentQueriesFromRuntime } from "../../workflows/container-contents/documentQueries";
import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsWorkflowRuntime,
} from "../../workflows/container-contents/runtime";
import { guardDocumentDiscoveryWrites } from "../../workflows/container-contents/syncPause/discoveryGuard";
import {
  createContainerDocumentTombstoneVerifier,
  createDocumentHeadLinkSetLoader,
} from "../../workflows/container-contents/tombstones/documentTombstoneEvidence";
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
import type { InternalRuntime } from "../runtime/workflowRuntime";

export type { ContainerDocumentDiscoveryOutcome } from "../../workflows/container-contents/documentDiscovery/documentDiscoveryLanes";

/** One container to discover, with the reconciler's per-lane callbacks. */
export interface ContainerDocumentDiscoveryRequest {
  readonly containerId: string;
  readonly onFullListing?:
    | ((documentIds: ReadonlyArray<string>) => void)
    | undefined;
  readonly onPendingDiscovery?: ((delayMs: number) => void) | undefined;
}

type ExecSql = ReturnType<InternalRuntime["workflowInput"]>["infra"]["execSql"];

function createDiscoveryLane(input: {
  readonly containerOrganizationId: string | undefined;
  readonly isContainerPaused: () => boolean;
  readonly evidenceStore: ReturnType<
    typeof createDocumentDiscoveryEvidenceStore
  >;
  readonly execSql: ExecSql;
  readonly queries: ReturnType<
    typeof createContainerDocumentQueriesFromRuntime
  >;
  readonly request: ContainerDocumentDiscoveryRequest;
  readonly runtime: ContainerContentsWorkflowRuntime;
}): ContainerDocumentDiscoveryLane {
  const { containerOrganizationId, execSql, request, runtime } = input;
  const warmReferencedPrincipalPolicies =
    createRuntimePrincipalPolicyWarmer(runtime);
  const loadHead = createDocumentHeadLinkSetLoader(runtime);
  const loadEpoch = (documentId: string) =>
    loadLocalDocumentAccessEpoch(execSql, documentId);
  return {
    ...input.queries,
    cacheReferencedPrincipalPolicies: (references) =>
      containerOrganizationId
        ? warmReferencedPrincipalPolicies({
            organizationId: containerOrganizationId,
            references,
          })
        : Promise.resolve(),
    containerId: request.containerId,
    holdContainerDocumentTombstones: (tombstones) =>
      holdContainerDocumentTombstones(execSql, tombstones),
    listHeldContainerDocumentTombstones: (containerIds) =>
      listRetryableHeldContainerDocumentTombstones(execSql, containerIds),
    listKnownContainerDocumentPlacements: (placements) =>
      listKnownContainerDocumentPlacements(execSql, placements),
    onFullListing: request.onFullListing,
    refuteContainerDocumentTombstoneHolds: (placements) =>
      refuteContainerDocumentTombstoneHolds(execSql, placements),
    verifyContainerDocumentTombstones: createContainerDocumentTombstoneVerifier(
      containerOrganizationId,
      loadHead,
      loadEpoch,
    ),
    ...guardDocumentDiscoveryWrites({
      execSql,
      isPaused: input.isContainerPaused,
      verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
        containerOrganizationId,
        loadHead,
        loadEpoch,
        input.evidenceStore,
        request.onPendingDiscovery,
      ),
    }),
  };
}

/**
 * Internal adapter shared by explicit discovery and background reconciliation:
 * one batched listing for every requested container, then per-container
 * verification scoped to each container's durable organization.
 */
export async function discoverContainerDocumentLanesForRuntime({
  onOutcome,
  requests,
  runtimeService,
}: {
  readonly onOutcome?: ContainerDocumentDiscoveryOutcomeHandler | undefined;
  readonly requests: ReadonlyArray<ContainerDocumentDiscoveryRequest>;
  readonly runtimeService: InternalRuntime;
}): Promise<ReadonlyArray<ContainerDocumentDiscoveryOutcome>> {
  const unlisted = (
    containerId: string,
  ): ContainerDocumentDiscoveryOutcome => ({
    containerId,
    status: "fulfilled",
    value: null,
  });
  const input = runtimeService.workflowInput();
  if (input.infra.dbStatus !== "ready") {
    return requests.map(({ containerId }) => unlisted(containerId));
  }
  const runtime = createContainerContentsWorkflowRuntime(input);
  const execSql = input.infra.execSql;
  const evidenceStore = createDocumentDiscoveryEvidenceStore(execSql);
  const queries = createContainerDocumentQueriesFromRuntime(runtime);
  // Capture the reset fence before reading any lane's scope, so a reset
  // between these reads and the listing cannot publish old-organization
  // evidence into its replacement.
  const generation = await evidenceStore.begin();
  const syncPauses = getOrCreateOrganizationSyncPauses(input.state.domainScope);
  await syncPauses.load(execSql);
  const lanes: ContainerDocumentDiscoveryLane[] = [];
  for (const request of requests) {
    const stored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        request.containerId,
      );
    if (!stored) continue;
    const isContainerPaused = () =>
      syncPauses.isContainerPaused(
        stored.container,
        runtimeService.workflowInput().auth.organizationId ?? null,
      );
    // A paused organization's container lists like one that is not stored,
    // and a pause landing mid-listing stops its write.
    if (!isContainerPaused())
      lanes.push(
        createDiscoveryLane({
          containerOrganizationId: stored.container.organizationId,
          isContainerPaused,
          evidenceStore,
          execSql,
          queries,
          request,
          runtime,
        }),
      );
  }
  const outcomes = await discoverContainerDocumentLanes({
    generation,
    lanes,
    listContainerDocumentLanes: (listed) =>
      listContainerDocumentLanesFromApi(runtime.apiClient, listed),
    loadContainerDocumentWatermark: queries.loadContainerDocumentWatermark,
    onOutcome,
  });
  const outcomeByContainerId = new Map(
    outcomes.map((outcome) => [outcome.containerId, outcome]),
  );
  return requests.map(
    ({ containerId }) =>
      outcomeByContainerId.get(containerId) ?? unlisted(containerId),
  );
}

/** Discovers one container; a rejected lane rethrows its failure. */
export async function discoverContainerDocumentsForRuntime({
  runtimeService,
  ...request
}: ContainerDocumentDiscoveryRequest & {
  readonly runtimeService: InternalRuntime;
}): Promise<ReadonlyArray<DocumentSummary> | null> {
  const [outcome] = await discoverContainerDocumentLanesForRuntime({
    requests: [request],
    runtimeService,
  });
  if (outcome?.status === "rejected") throw outcome.reason;
  return outcome?.value ?? null;
}
