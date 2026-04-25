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
  | "execSql"
  | "isAuthenticated"
  | "log"
  | "online"
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
    execSql,
    isAuthenticated,
    log,
    online,
  } = appData;

  return {
    apiClient: {
      commitDocumentChange: apiClient.commitDocumentChange.bind(apiClient),
      createDocument: apiClient.createDocument.bind(apiClient),
      getBlob: apiClient.getBlob.bind(apiClient),
      listContainers: apiClient.listContainers.bind(apiClient),
      listDocumentAttachments:
        apiClient.listDocumentAttachments.bind(apiClient),
      stageBlob: apiClient.stageBlob.bind(apiClient),
      syncDocument: apiClient.syncDocument.bind(apiClient),
    },
    blobStore,
    cacheReferencedPrincipalPolicies,
    containerId,
    dbStatus,
    domainScope,
    encapsulationKeyPair,
    events: [],
    execSql,
    isAuthenticated,
    log,
    online,
  };
}
