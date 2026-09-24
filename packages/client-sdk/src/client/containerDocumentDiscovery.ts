import type { DocumentSummary } from "../data/documents/documentSummary";
import {
  holdContainerDocumentTombstones,
  listKnownContainerDocumentPlacements,
  listRetryableHeldContainerDocumentTombstones,
  loadLocalDocumentAccessEpoch,
  releaseContainerDocumentTombstoneHolds,
} from "../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import { createDocumentDiscoveryEvidenceStore } from "../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type { ContainerContentsStore } from "../stores/container-contents";
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
export function discoverContainerDocumentsForRuntime({
  containerId,
  getContainerStore,
  onFullListing,
  onPendingDiscovery,
  runtimeService,
}: {
  containerId: string;
  getContainerStore: () => ContainerContentsStore;
  onFullListing?: ((documentIds: ReadonlyArray<string>) => void) | undefined;
  onPendingDiscovery?: ((delayMs: number) => void) | undefined;
  runtimeService: InternalRuntime;
}): Promise<ReadonlyArray<DocumentSummary> | null> {
  const input = runtimeService.workflowInput();
  if (input.infra.dbStatus !== "ready") {
    return Promise.resolve(null);
  }
  const runtime = createContainerContentsWorkflowRuntime(input);
  const containerOrganizationId = getContainerStore()
    .getSnapshot()
    .nodes.find((node) => node.id === containerId)?.organizationId;
  const warmReferencedPrincipalPolicies =
    createRuntimePrincipalPolicyWarmer(runtime);

  const evidenceStore = createDocumentDiscoveryEvidenceStore(
    input.infra.execSql,
  );
  const loadHead = createDocumentHeadLinkSetLoader(runtime);
  const loadEpoch = (documentId: string) =>
    loadLocalDocumentAccessEpoch(input.infra.execSql, documentId);
  return discoverContainerDocumentsFromApi({
    ...createContainerDocumentQueriesFromRuntime(runtime),
    apiClient: runtime.apiClient,
    beginDocumentDiscovery: () => evidenceStore.begin(),
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
    releaseContainerDocumentTombstoneHolds: (placements) =>
      releaseContainerDocumentTombstoneHolds(input.infra.execSql, placements),
    verifyContainerDocumentTombstones: createContainerDocumentTombstoneVerifier(
      loadHead,
      loadEpoch,
    ),
    verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
      loadHead,
      loadEpoch,
      evidenceStore,
      onPendingDiscovery,
    ),
  });
}
