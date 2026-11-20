import type { DocumentSummary } from "../../data/documents/documentSummary";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { ContainerDocumentTombstoneHoldRepository } from "../../data/persistence/documents/containerDocumentTombstoneHoldRepository";
import { DocumentDiscoveryEvidenceRepository } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { waitForRead } from "../../data/shared/waitForRead";
import { getOrCreateOrganizationSyncPauses } from "../../data/sync/organizationSyncPauses";
import { listContainerDocumentLanesFromApi } from "../../workflows/container-contents/documentDiscovery/containerDocumentListing";
import { createDiscoveredDocumentVerifier } from "../../workflows/container-contents/documentDiscovery/documentDiscoveryEvidence";
import {
  type ContainerDocumentDiscoveryLane,
  type ContainerDocumentDiscoveryOutcome,
  type ContainerDocumentDiscoveryOutcomeHandler,
  discoverContainerDocumentLanes,
} from "../../workflows/container-contents/documentDiscovery/documentDiscoveryLanes";
import { ContainerDocumentListingUnavailableError } from "../../workflows/container-contents/documentDiscovery/documentDiscoveryTypes";
import { createContainerDocumentQueriesFromRuntime } from "../../workflows/container-contents/documentQueries";
import {
  type ContainerContentsWorkflowRuntime,
  createContainerContentsWorkflowRuntimeFromSnapshot,
} from "../../workflows/container-contents/runtime";
import { guardDocumentDiscoveryWrites } from "../../workflows/container-contents/syncPause/discoveryGuard";
import {
  createContainerDocumentTombstoneVerifier,
  createDocumentHeadLinkSetLoader,
} from "../../workflows/container-contents/tombstones/documentTombstoneEvidence";
import {
  createPrincipalPolicyOperation,
  type PrincipalPolicyOperation,
} from "../../workflows/principals/principalPolicyService";
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
  readonly signal?: AbortSignal | undefined;
  readonly isContainerPaused: () => boolean;
  readonly evidenceStore: DocumentDiscoveryEvidenceRepository;
  readonly execSql: ExecSql;
  readonly holdRepository: ContainerDocumentTombstoneHoldRepository;
  /** The discovery pass's token: its lanes share one directory discovery. */
  readonly policyOperation: PrincipalPolicyOperation;
  readonly queries: ReturnType<
    typeof createContainerDocumentQueriesFromRuntime
  >;
  readonly request: ContainerDocumentDiscoveryRequest;
  readonly runtime: ContainerContentsWorkflowRuntime;
}): ContainerDocumentDiscoveryLane {
  const { containerOrganizationId, execSql, holdRepository, request, runtime } =
    input;
  const warmReferencedPrincipalPolicies =
    runtime.principalPolicies.createWarmer({
      operation: input.policyOperation,
    });
  const loadHead = createDocumentHeadLinkSetLoader(
    runtime,
    undefined,
    input.policyOperation,
    input.signal,
  );
  const loadEpoch = (documentId: string) =>
    holdRepository.loadLocalDocumentAccessEpoch(documentId);
  return {
    ...input.queries,
    cacheReferencedPrincipalPolicies: (references) =>
      containerOrganizationId
        ? waitForRead(
            warmReferencedPrincipalPolicies({
              organizationId: containerOrganizationId,
              references,
              stillCurrent: () => !input.isContainerPaused(),
            }),
            input.signal,
          )
        : Promise.resolve(),
    containerId: request.containerId,
    listHeldContainerDocumentTombstones: (containerIds) =>
      holdRepository.listRetryableHeldContainerDocumentTombstones(containerIds),
    listKnownContainerDocumentPlacements: (placements) =>
      holdRepository.listKnownContainerDocumentPlacements(placements),
    onFullListing: (ids) => {
      if (!input.isContainerPaused()) request.onFullListing?.(ids);
    },
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
        (delayMs) => {
          if (!input.isContainerPaused()) request.onPendingDiscovery?.(delayMs);
        },
      ),
    }),
  };
}

/**
 * Internal adapter shared by explicit discovery and background reconciliation:
 * one batched listing for every requested container, then per-container
 * verification scoped to each container's durable organization.
 */
export function discoverContainerDocumentLanesForRuntime(input: {
  readonly signal?: AbortSignal | undefined;
  readonly onOutcome?: ContainerDocumentDiscoveryOutcomeHandler | undefined;
  readonly requests: ReadonlyArray<ContainerDocumentDiscoveryRequest>;
  readonly runtimeService: InternalRuntime;
}): Promise<ReadonlyArray<ContainerDocumentDiscoveryOutcome>> {
  return waitForRead(discoverLanes(input), input.signal);
}

async function discoverLanes({
  onOutcome,
  signal,
  requests,
  runtimeService,
}: Parameters<typeof discoverContainerDocumentLanesForRuntime>[0]) {
  const unlisted = (
    containerId: string,
  ): ContainerDocumentDiscoveryOutcome => ({
    containerId,
    status: "fulfilled",
    value: null,
  });
  signal?.throwIfAborted();
  const input = runtimeService.workflowInput();
  if (input.infra.dbStatus !== "ready") {
    return requests.map(({ containerId }) => unlisted(containerId));
  }
  const runtime = createContainerContentsWorkflowRuntimeFromSnapshot({
    ...input,
    organizations: runtimeService.containerContentsOrganizations,
  });
  const execSql = input.infra.execSql;
  const evidenceStore = new DocumentDiscoveryEvidenceRepository(
    execSql,
    undefined,
    signal,
  );
  const holdRepository = new ContainerDocumentTombstoneHoldRepository(execSql);
  const queries = createContainerDocumentQueriesFromRuntime(runtime);
  // Capture the reset fence before reading any lane's scope, so a reset
  // between these reads and the listing cannot publish old-organization
  // evidence into its replacement.
  const generation = await evidenceStore.begin();
  signal?.throwIfAborted();
  const syncPauses = getOrCreateOrganizationSyncPauses(input.state.domainScope);
  await syncPauses.load(execSql);
  signal?.throwIfAborted();
  const lanes: ContainerDocumentDiscoveryLane[] = [];
  const policyOperation = createPrincipalPolicyOperation();
  for (const request of requests) {
    const stored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        request.containerId,
      );
    signal?.throwIfAborted();
    if (!stored) continue;
    const isContainerPaused = () =>
      signal?.aborted === true ||
      syncPauses.isContainerPaused(stored.container);
    // A paused organization's container lists like one that is not stored,
    // and a pause landing mid-listing stops its write.
    if (!isContainerPaused())
      lanes.push(
        createDiscoveryLane({
          containerOrganizationId: stored.container.organizationId,
          isContainerPaused,
          signal,
          evidenceStore,
          execSql,
          holdRepository,
          policyOperation,
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
      listContainerDocumentLanesFromApi(
        runtime.apiClient,
        listed,
        true,
        signal,
      ),
    loadContainerDocumentWatermark: queries.loadContainerDocumentWatermark,
    onOutcome: async (outcome) => {
      if (!signal?.aborted) return onOutcome?.(outcome);
    },
  });
  signal?.throwIfAborted();
  const outcomeByContainerId = new Map(
    outcomes.map((outcome) => [outcome.containerId, outcome]),
  );
  return requests.map(
    ({ containerId }) =>
      outcomeByContainerId.get(containerId) ?? unlisted(containerId),
  );
}

/**
 * Discovers one container; a rejected lane rethrows its failure, except an
 * unavailable listing, which this contract reports as `null`.
 */
export async function discoverContainerDocumentsForRuntime({
  runtimeService,
  signal,
  ...request
}: ContainerDocumentDiscoveryRequest & {
  readonly signal?: AbortSignal | undefined;
  readonly runtimeService: InternalRuntime;
}): Promise<ReadonlyArray<DocumentSummary> | null> {
  const [outcome] = await discoverContainerDocumentLanesForRuntime({
    requests: [request],
    runtimeService,
    signal,
  });
  if (outcome?.status === "rejected") {
    if (outcome.reason instanceof ContainerDocumentListingUnavailableError) {
      return null;
    }
    throw outcome.reason;
  }
  return outcome?.value ?? null;
}
