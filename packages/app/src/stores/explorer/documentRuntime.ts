import { useMemo } from "react";
import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import type { primeDocumentStore } from "../documents/DocumentsProvider";

type ExplorerDocumentRuntime = Parameters<typeof primeDocumentStore>[2];

export type ExplorerDocumentsRuntimeAppDataInput = Pick<
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

export type ExplorerDocumentsRuntimeAppData =
  ExplorerDocumentsRuntimeAppDataInput & {
    resolveProjectionUserKey: ProjectionUserKeyResolver;
  };

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

export function useExplorerDocumentsRuntimeAppData(
  appData: ExplorerDocumentsRuntimeAppDataInput,
): ExplorerDocumentsRuntimeAppData {
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
  const resolveProjectionUserKey = useMemo(
    () =>
      createProjectionUserKeyResolver(
        {
          apiClient,
          encapsulationKeyPair,
          log,
          signingFingerprint,
          signingKeyPair,
          userId,
        },
        "Explorer documents",
      ),
    [
      apiClient,
      encapsulationKeyPair,
      log,
      signingFingerprint,
      signingKeyPair,
      userId,
    ],
  );

  return useMemo(
    () => ({
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
      resolveProjectionUserKey,
    }),
    [
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
      resolveProjectionUserKey,
    ],
  );
}
