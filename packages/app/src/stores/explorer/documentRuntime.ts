import { useMemo } from "react";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import {
  createExplorerDocumentProjectionUserKeyResolver,
  type ExplorerProjectionUserKeyResolver,
} from "../../workflows/explorer";
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
    resolveProjectionUserKey: ExplorerProjectionUserKeyResolver;
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
      createExplorerDocumentProjectionUserKeyResolver({
        apiClient,
        encapsulationKeyPair,
        log,
        signingFingerprint,
        signingKeyPair,
        userId,
      }),
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
