import type { DocumentSummary } from "../../data/documents/documentSummary";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { ContainerDocumentTombstoneHoldRepository } from "../../data/persistence/documents/containerDocumentTombstoneHoldRepository";
import { DocumentDiscoveryEvidenceRepository } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { isDatabaseUnavailableError } from "../../data/sqlite/availability/databaseUnavailable";
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
import {
  findOwedDocumentLaneListings,
  settleOwedDocumentLaneListing,
} from "../../workflows/container-contents/documentDiscovery/documentLaneDiscovery";
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
import { requestRegisteredDocumentRemoteSyncs } from "./owedRecordSyncs";

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

/**
 * Reports a failure the listing does not wait on, unless the database closed
 * under it: the runtime is going away, and the next one reads what is owed.
 */
function reportUnlessDatabaseClosed(
  logError: (message: string, error: unknown) => void,
  message: string,
): (error: unknown) => void {
  return (error) => {
    if (!isDatabaseUnavailableError(error)) logError(message, error);
  };
}

function createDiscoveryLane(input: {
  readonly containerOrganizationId: string | undefined;
  readonly isContainerPaused: () => boolean;
  readonly evidenceStore: DocumentDiscoveryEvidenceRepository;
  readonly execSql: ExecSql;
  readonly holdRepository: ContainerDocumentTombstoneHoldRepository;
  readonly logError: (message: string, error: unknown) => void;
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
  );
  const loadEpoch = (documentId: string) =>
    holdRepository.loadLocalDocumentAccessEpoch(documentId);
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
    // The debts are durable by now. A loaded store whose own record owes
    // probes at once; one that loads later reads its record's debt itself.
    onDocumentReadsOwed: (documentIds) => {
      void requestRegisteredDocumentRemoteSyncs(
        runtime.state.domainScope,
        execSql,
        documentIds,
      ).catch(
        reportUnlessDatabaseClosed(
          input.logError,
          "Owed document reads were not requested",
        ),
      );
    },
    listHeldContainerDocumentTombstones: (containerIds) =>
      holdRepository.listRetryableHeldContainerDocumentTombstones(containerIds),
    listKnownContainerDocumentPlacements: (placements) =>
      holdRepository.listKnownContainerDocumentPlacements(placements),
    onFullListing: request.onFullListing,
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
    unlisted: true,
    value: null,
  });
  const input = runtimeService.workflowInput();
  if (input.infra.dbStatus !== "ready") {
    return requests.map(({ containerId }) => unlisted(containerId));
  }
  const runtime = createContainerContentsWorkflowRuntimeFromSnapshot({
    ...input,
    organizations: runtimeService.containerContentsOrganizations,
  });
  const execSql = input.infra.execSql;
  const evidenceStore = new DocumentDiscoveryEvidenceRepository(execSql);
  const holdRepository = new ContainerDocumentTombstoneHoldRepository(execSql);
  const queries = createContainerDocumentQueriesFromRuntime(runtime);
  // Capture the reset fence before reading any lane's scope, so a reset
  // between these reads and the listing cannot publish old-organization
  // evidence into its replacement.
  const generation = await evidenceStore.begin();
  const syncPauses = getOrCreateOrganizationSyncPauses(input.state.domainScope);
  await syncPauses.load(execSql);
  const lanes: ContainerDocumentDiscoveryLane[] = [];
  const policyOperation = createPrincipalPolicyOperation();
  for (const request of requests) {
    const stored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        request.containerId,
      );
    if (!stored) continue;
    const isContainerPaused = () =>
      syncPauses.isContainerPaused(stored.container);
    // A paused organization's container lists like one that is not stored,
    // and a pause landing mid-listing stops its write.
    if (!isContainerPaused())
      lanes.push(
        createDiscoveryLane({
          containerOrganizationId: stored.container.organizationId,
          isContainerPaused,
          evidenceStore,
          execSql,
          holdRepository,
          logError: input.util.logError,
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
    // A listing settles lane requests and acknowledges hints: it is never
    // answered from a request sent before it.
    listContainerDocumentLanes: (listed) =>
      listContainerDocumentLanesFromApi(
        runtime.apiClient,
        listed,
        true,
        "ownRequest",
      ),
    loadContainerDocumentWatermark: queries.loadContainerDocumentWatermark,
    loadOwedLaneListings: (containerIds) =>
      findOwedDocumentLaneListings(execSql, containerIds),
    onOutcome,
    reportSettleFailure: reportUnlessDatabaseClosed(
      input.util.logError,
      "Document lane request settle failed",
    ),
    settleOwedLaneListing: (owed) =>
      settleOwedDocumentLaneListing(execSql, owed),
  });
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
  ...request
}: ContainerDocumentDiscoveryRequest & {
  readonly runtimeService: InternalRuntime;
}): Promise<ReadonlyArray<DocumentSummary> | null> {
  const [outcome] = await discoverContainerDocumentLanesForRuntime({
    requests: [request],
    runtimeService,
  });
  if (outcome?.status === "rejected") {
    if (outcome.reason instanceof ContainerDocumentListingUnavailableError) {
      return null;
    }
    throw outcome.reason;
  }
  return outcome?.value ?? null;
}
