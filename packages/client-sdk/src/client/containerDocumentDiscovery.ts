import type { DocumentSummary } from "../data/documents/documentSummary";
import { sqlContainerContentsPersistence } from "../data/persistence/container-contents/containerContentsPersistence";
import {
  holdContainerDocumentTombstones,
  listKnownContainerDocumentPlacements,
  listRetryableHeldContainerDocumentTombstones,
  loadLocalDocumentAccessEpoch,
  refuteContainerDocumentTombstoneHolds,
} from "../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import { createDocumentDiscoveryEvidenceStore } from "../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { discoverContainerDocumentsFromApi } from "../workflows/container-contents/documentDiscovery";
import { createDiscoveredDocumentVerifier } from "../workflows/container-contents/documentDiscoveryEvidence";
import { createContainerDocumentQueriesFromRuntime } from "../workflows/container-contents/documentQueries";
import {
  createContainerDocumentTombstoneVerifier,
  createDocumentHeadLinkSetLoader,
} from "../workflows/container-contents/documentTombstoneEvidence";
import { createContainerContentsWorkflowRuntime } from "../workflows/container-contents/runtime";
import { createRuntimePrincipalPolicyWarmer } from "../workflows/principals/runtimePolicyWarmer";
import type { InternalRuntime } from "./workflowRuntime";

/** Internal adapter shared by explicit discovery and background reconciliation. */
export async function discoverContainerDocumentsForRuntime({
  containerId,
  onFullListing,
  onPendingDiscovery,
  runtimeService,
}: {
  containerId: string;
  onFullListing?: ((documentIds: ReadonlyArray<string>) => void) | undefined;
  onPendingDiscovery?: ((delayMs: number) => void) | undefined;
  runtimeService: InternalRuntime;
}): Promise<ReadonlyArray<DocumentSummary> | null> {
  const input = runtimeService.workflowInput();
  if (input.infra.dbStatus !== "ready") {
    return null;
  }
  const runtime = createContainerContentsWorkflowRuntime(input);
  const evidenceStore = createDocumentDiscoveryEvidenceStore(
    input.infra.execSql,
  );
  // Capture the reset fence before reading scope, so a reset between this read
  // and listing cannot publish old-organization evidence into its replacement.
  const generation = await evidenceStore.begin();
  const stored =
    await sqlContainerContentsPersistence.loadContainerMetadataState(
      input.infra.execSql,
      containerId,
    );
  if (!stored) return null;
  const containerOrganizationId = stored.container.organizationId;
  const warmReferencedPrincipalPolicies =
    createRuntimePrincipalPolicyWarmer(runtime);
  const loadHead = createDocumentHeadLinkSetLoader(runtime);
  const loadEpoch = (documentId: string) =>
    loadLocalDocumentAccessEpoch(input.infra.execSql, documentId);
  return discoverContainerDocumentsFromApi({
    ...createContainerDocumentQueriesFromRuntime(runtime),
    apiClient: runtime.apiClient,
    beginDocumentDiscovery: async () => generation,
    cacheReferencedPrincipalPolicies: (references) =>
      containerOrganizationId
        ? warmReferencedPrincipalPolicies({
            organizationId: containerOrganizationId,
            references,
          })
        : Promise.resolve(),
    containerId,
    holdContainerDocumentTombstones: (tombstones) =>
      holdContainerDocumentTombstones(input.infra.execSql, tombstones),
    listHeldContainerDocumentTombstones: (containerIds) =>
      listRetryableHeldContainerDocumentTombstones(
        input.infra.execSql,
        containerIds,
      ),
    listKnownContainerDocumentPlacements: (placements) =>
      listKnownContainerDocumentPlacements(input.infra.execSql, placements),
    onFullListing,
    refuteContainerDocumentTombstoneHolds: (placements) =>
      refuteContainerDocumentTombstoneHolds(input.infra.execSql, placements),
    verifyContainerDocumentTombstones: createContainerDocumentTombstoneVerifier(
      containerOrganizationId,
      loadHead,
      loadEpoch,
    ),
    verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
      containerOrganizationId,
      loadHead,
      loadEpoch,
      evidenceStore,
      onPendingDiscovery,
    ),
  });
}
