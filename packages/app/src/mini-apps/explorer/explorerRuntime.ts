import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import type { primeDocumentStore } from "../../stores/documents/DocumentsProvider";

type ExplorerDocumentRuntime = Parameters<typeof primeDocumentStore>[2];

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
    apiClient,
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
