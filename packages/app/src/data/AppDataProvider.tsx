import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useApiClient } from "../api/ApiClientProvider";
import { useNetworkState } from "../api/NetworkStateProvider";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { useDatabase } from "../db/DatabaseProvider";
import { useEvents } from "../events/EventsProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useLog } from "../logging/LogProvider";
import { useBlobStore } from "./blobs";
import { createExecSql, type ExecSql } from "./persistence/sqlSchema";
import { cacheReferencedPrincipalPolicies } from "./principalPolicySync";

export interface AppDataContextValue {
  apiClient: ReturnType<typeof useApiClient>;
  authToken: string | null;
  blobStore: ReturnType<typeof useBlobStore>;
  cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
  containerId: string | null;
  dbId: string | null;
  dbStatus: ReturnType<typeof useDatabase>["status"];
  domainScope: object;
  encapsulationKeyPair: ReturnType<typeof useIdentity>["encapsulationKeyPair"];
  events: ReturnType<typeof useEvents>["events"];
  execSql: ExecSql;
  isAuthenticated: boolean;
  log: ReturnType<typeof useLog>["log"];
  online: boolean;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);
const unavailableExecSql: ExecSql = async () => {
  throw new Error("Database client is unavailable.");
};

export function AppDataProvider({ children }: PropsWithChildren) {
  const apiClient = useApiClient();
  const blobStore = useBlobStore();
  const { online } = useNetworkState();
  const { client: dbClient, id: dbId, status: dbStatus } = useDatabase();
  const { authToken, containerId, isAuthenticated } = useCryptoSession();
  const { encapsulationKeyPair, signingFingerprint } = useIdentity();
  const { events } = useEvents();
  const { log } = useLog();
  const domainScope = useMemo(() => ({}), [dbId, signingFingerprint]);

  const execSql = useMemo(
    () => (dbClient ? createExecSql(dbClient) : unavailableExecSql),
    [dbClient],
  );
  const cacheReferencedPrincipalPoliciesCallback = useCallback(
    async (
      references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
    ) => {
      await cacheReferencedPrincipalPolicies({
        execSql,
        getEncapsulationKey: (userId) => apiClient.getEncapsulationKey(userId),
        getCurrentPrincipalPolicy: (principalType, principalId) =>
          apiClient.getCurrentPrincipalPolicy(principalType, principalId),
        log,
        references,
      });
    },
    [apiClient, execSql, log],
  );

  const value = useMemo(
    () => ({
      apiClient,
      authToken,
      blobStore,
      cacheReferencedPrincipalPolicies:
        cacheReferencedPrincipalPoliciesCallback,
      containerId,
      dbId,
      dbStatus,
      domainScope,
      encapsulationKeyPair,
      events,
      execSql,
      isAuthenticated,
      log,
      online,
    }),
    [
      apiClient,
      authToken,
      blobStore,
      cacheReferencedPrincipalPoliciesCallback,
      containerId,
      dbId,
      dbStatus,
      domainScope,
      encapsulationKeyPair,
      events,
      execSql,
      isAuthenticated,
      log,
      online,
      signingFingerprint,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used within an AppDataProvider.");
  }

  return context;
}
