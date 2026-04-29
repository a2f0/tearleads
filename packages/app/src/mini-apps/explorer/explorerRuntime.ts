import type { AppDataContextValue } from "../../data/AppDataProvider";

type ExplorerDocumentRuntime = Parameters<
  typeof import("../../data/documents/DocumentsProvider").primeDocumentStore
>[2];

export type ExplorerDocumentsRuntimeAppData = Pick<
  AppDataContextValue,
  | "apiClient"
  | "blobStore"
  | "cacheReferencedPrincipalPolicies"
  | "dbStatus"
  | "domainScope"
  | "encapsulationKeyPair"
  | "events"
  | "execSql"
  | "isAuthenticated"
  | "log"
  | "online"
  | "organizationId"
  | "signingFingerprint"
  | "signingKeyPair"
  | "userId"
>;

export function isDestroyedDatabaseWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

export function createExplorerDocumentsRuntime(
  appData: ExplorerDocumentsRuntimeAppData,
  containerId: string,
): ExplorerDocumentRuntime {
  const {
    apiClient,
    blobStore,
    cacheReferencedPrincipalPolicies,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    events,
    execSql,
    isAuthenticated,
    log,
    online,
    organizationId,
    signingFingerprint,
    signingKeyPair,
    userId,
  } = appData;

  return {
    apiClient: {
      createDocumentV2: apiClient.createDocumentV2.bind(apiClient),
      getContainerV2WriterProjection:
        apiClient.getContainerV2WriterProjection.bind(apiClient),
      getDocumentV2WriterProjection:
        apiClient.getDocumentV2WriterProjection.bind(apiClient),
      getBlob: apiClient.getBlob.bind(apiClient),
      listContainers: apiClient.listContainers.bind(apiClient),
      listDocumentAttachments:
        apiClient.listDocumentAttachments.bind(apiClient),
      bindBlobAttachmentV2: apiClient.bindBlobAttachmentV2.bind(apiClient),
      stageBlob: apiClient.stageBlob.bind(apiClient),
      syncDocumentV2: apiClient.syncDocumentV2.bind(apiClient),
    },
    blobStore,
    cacheReferencedPrincipalPolicies,
    containerId,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    events,
    execSql,
    isAuthenticated,
    log,
    online,
    organizationId,
    signingFingerprint,
    signingKeyPair,
    userId,
  };
}
