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
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLog } from "../logging/LogProvider";
import { usePersona } from "../persona/PersonaProvider";
import { useBlobStore } from "./blobs";
import type { SqlRow, SqlRowValue } from "./persistence/sqlSchema";
import { cacheReferencedPrincipalPolicies } from "./principalPolicySync";

interface AppDataContextValue {
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
  encapsulationKeyPair: ReturnType<typeof usePersona>["encapsulationKeyPair"];
  events: ReturnType<typeof useEvents>["events"];
  execSql: (
    sql: string,
    bind?: Record<string, SqlRowValue>,
  ) => Promise<SqlRow[]>;
  isAuthenticated: boolean;
  log: ReturnType<typeof useLog>["log"];
  online: boolean;
  trustedPolicySigners: ReadonlyMap<string, Uint8Array>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: PropsWithChildren) {
  const apiClient = useApiClient();
  const blobStore = useBlobStore();
  const { online } = useNetworkState();
  const { client: dbClient, id: dbId, status: dbStatus } = useDatabase();
  const { authToken, containerId, isAuthenticated } = useCryptoSession();
  const { encapsulationKeyPair, signingFingerprint } = usePersona();
  const { trustedPolicySigners } = useAppHostConfig();
  const { events } = useEvents();
  const { log } = useLog();
  const domainScope = useMemo(() => ({}), [dbId, signingFingerprint]);

  const execSql = useCallback(
    async (sql: string, bind?: Record<string, SqlRowValue>) => {
      if (!dbClient) {
        throw new Error("Database client is unavailable.");
      }

      const result = await dbClient.exec(bind ? { sql, bind } : { sql });
      return result.rows;
    },
    [dbClient],
  );
  const cacheReferencedPrincipalPoliciesCallback = useCallback(
    async (
      references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
    ) => {
      await cacheReferencedPrincipalPolicies({
        execSql,
        getCurrentPrincipalPolicy: (principalType, principalId) =>
          apiClient.getCurrentPrincipalPolicy(principalType, principalId),
        log,
        references,
        trustedPolicySigners,
      });
    },
    [apiClient, execSql, log, trustedPolicySigners],
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
      trustedPolicySigners,
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
      trustedPolicySigners,
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
