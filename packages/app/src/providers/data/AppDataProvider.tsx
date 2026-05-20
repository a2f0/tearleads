import {
  createExecSql,
  type DocumentProjectorRegistry,
  type ExecSql,
  unavailableExecSql,
} from "@tearleads/client-sdk";
import { cacheReferencedPrincipalPolicies } from "@tearleads/client-sdk/workflows/principals";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../document-types/projectors";
import { useApiClient } from "../api/ApiClientProvider";
import { useNetworkState } from "../api/NetworkStateProvider";
import { useBlobStore } from "../blobs/BlobProvider";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { useDatabase } from "../db/DatabaseProvider";
import { useEvents } from "../events/EventsProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";

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
  documentProjectors: DocumentProjectorRegistry;
  domainScope: object;
  encapsulationKeyPair: ReturnType<typeof useIdentity>["encapsulationKeyPair"];
  events: ReturnType<typeof useEvents>["events"];
  execSql: ExecSql;
  isAuthenticated: boolean;
  log: ReturnType<typeof useLog>["log"];
  logError: ReturnType<typeof useLog>["logError"];
  online: boolean;
  organizationId: ReturnType<typeof useCryptoSession>["organizationId"];
  signingFingerprint: ReturnType<typeof useIdentity>["signingFingerprint"];
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"];
  userId: ReturnType<typeof useCryptoSession>["userId"];
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

function useReferencedPrincipalPolicyCache(params: {
  apiClient: AppDataContextValue["apiClient"];
  execSql: ExecSql;
  log: AppDataContextValue["log"];
}): AppDataContextValue["cacheReferencedPrincipalPolicies"] {
  const { apiClient, execSql, log } = params;

  return useCallback(
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
}

export function AppDataProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const apiClient = useApiClient();
  const blobStore = useBlobStore();
  const { online } = useNetworkState();
  const { client: dbClient, id: dbId, status: dbStatus } = useDatabase();
  const { authToken, containerId, isAuthenticated, organizationId, userId } =
    useCryptoSession();
  const { encapsulationKeyPair, signingFingerprint, signingKeyPair } =
    useIdentity();
  const { events } = useEvents();
  const { log, logError } = useLog();
  const domainScope = tearleads.domainScope;

  const execSql = useMemo(
    () => (dbClient ? createExecSql(dbClient) : unavailableExecSql),
    [dbClient],
  );
  const cacheReferencedPrincipalPoliciesCallback =
    useReferencedPrincipalPolicyCache({ apiClient, execSql, log });

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
      documentProjectors: APP_DOCUMENT_PROJECTOR_REGISTRY,
      domainScope,
      encapsulationKeyPair,
      events,
      execSql,
      isAuthenticated,
      log,
      logError,
      online,
      organizationId,
      signingFingerprint,
      signingKeyPair,
      userId,
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
      logError,
      online,
      organizationId,
      signingFingerprint,
      signingKeyPair,
      userId,
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
