import type { DocumentSummary } from "../data/documents/documentSummary";
import type { ContainerContentsStore } from "../stores/container-contents";
import { discoverContainerDocumentsFromApi } from "../workflows/container-contents/documentDiscovery";
import { createContainerDocumentQueriesFromRuntime } from "../workflows/container-contents/documentQueries";
import { createContainerContentsWorkflowRuntime } from "../workflows/container-contents/runtime";
import { createRuntimePrincipalPolicyWarmer } from "../workflows/principals/runtimePolicyWarmer";
import type { InternalRuntime } from "./workflowRuntime";

/** Internal adapter shared by explicit discovery and background reconciliation. */
export function discoverContainerDocumentsForRuntime({
  containerId,
  getContainerStore,
  onFullListing,
  runtimeService,
}: {
  containerId: string;
  getContainerStore: () => ContainerContentsStore;
  onFullListing?: ((documentIds: ReadonlyArray<string>) => void) | undefined;
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

  return discoverContainerDocumentsFromApi({
    ...createContainerDocumentQueriesFromRuntime(runtime),
    apiClient: runtime.apiClient,
    cacheReferencedPrincipalPolicies: (references) =>
      containerOrganizationId
        ? warmReferencedPrincipalPolicies({
            organizationId: containerOrganizationId,
            references,
          })
        : Promise.resolve(),
    containerId,
    onFullListing,
  });
}
