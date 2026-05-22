import {
  type ContainerContentsWorkflowRuntime,
  type ContainerInfo,
  type ContainerInfoRemoteMode,
  createContainerContentsWorkflowRuntime,
  discoverContainerDocumentsFromApi,
  loadContainerInfo,
  refreshAllContainerDocumentsFromApi,
} from "../workflows/container-contents";
import type { TearleadsInternalRuntime } from "./workflowRuntime";

export type TearleadsContainerDocumentDiscoveryInput = Omit<
  Parameters<typeof discoverContainerDocumentsFromApi>[0],
  "apiClient" | "cacheReferencedPrincipalPolicies"
>;

export type TearleadsContainerDocumentRefreshInput = Omit<
  Parameters<typeof refreshAllContainerDocumentsFromApi>[0],
  "apiClient" | "cacheReferencedPrincipalPolicies"
>;

export interface TearleadsContainerInfoInput {
  containerId: string;
  parentId?: string | null | undefined;
  remoteInfoMode?: ContainerInfoRemoteMode | undefined;
}

export interface TearleadsContainerContents {
  discoverDocuments(
    input: TearleadsContainerDocumentDiscoveryInput,
  ): ReturnType<typeof discoverContainerDocumentsFromApi>;
  loadInfo(input: TearleadsContainerInfoInput): Promise<ContainerInfo>;
  refreshDocuments(
    input: TearleadsContainerDocumentRefreshInput,
  ): ReturnType<typeof refreshAllContainerDocumentsFromApi>;
  runtime(): ContainerContentsWorkflowRuntime;
}

export function createTearleadsContainerContents(
  runtime: TearleadsInternalRuntime,
): TearleadsContainerContents {
  return new TearleadsContainerContentsService(runtime);
}

class TearleadsContainerContentsService implements TearleadsContainerContents {
  constructor(private readonly runtimeService: TearleadsInternalRuntime) {}

  discoverDocuments(
    input: TearleadsContainerDocumentDiscoveryInput,
  ): ReturnType<typeof discoverContainerDocumentsFromApi> {
    const runtime = this.runtimeService.workflowInput();
    return discoverContainerDocumentsFromApi({
      ...input,
      apiClient: runtime.apiClient,
      cacheReferencedPrincipalPolicies:
        runtime.cacheReferencedPrincipalPolicies,
    });
  }

  loadInfo(input: TearleadsContainerInfoInput): Promise<ContainerInfo> {
    const runtime = this.runtimeService.workflowInput();
    return loadContainerInfo({
      ...input,
      apiClient: runtime.apiClient,
      execSql: runtime.dbStatus === "ready" ? runtime.execSql : null,
      organizationId: runtime.organizationId,
      parentId: input.parentId ?? null,
    });
  }

  refreshDocuments(
    input: TearleadsContainerDocumentRefreshInput,
  ): ReturnType<typeof refreshAllContainerDocumentsFromApi> {
    const runtime = this.runtimeService.workflowInput();
    return refreshAllContainerDocumentsFromApi({
      ...input,
      apiClient: runtime.apiClient,
      cacheReferencedPrincipalPolicies:
        runtime.cacheReferencedPrincipalPolicies,
    });
  }

  runtime(): ContainerContentsWorkflowRuntime {
    return createContainerContentsWorkflowRuntime(
      this.runtimeService.workflowInput(),
    );
  }
}
