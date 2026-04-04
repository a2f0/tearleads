import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { useApiClient } from "../api/ApiClientProvider";
import { useNetworkState } from "../api/NetworkStateProvider";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { useDatabase } from "../db/DatabaseProvider";
import { useEvents } from "../events/EventsProvider";
import { useLog } from "../logging/LogProvider";

import type { SqlRow, SqlRowValue } from "./sqlSchema";

interface AppDataContextValue {
  apiClient: ReturnType<typeof useApiClient>;
  authToken: string | null;
  containerId: string | null;
  dbId: string | null;
  dbStatus: ReturnType<typeof useDatabase>["status"];
  domainScope: object;
  encapsulationKeyPair: ReturnType<
    typeof useCryptoSession
  >["encapsulationKeyPair"];
  events: ReturnType<typeof useEvents>["events"];
  execSql: (
    sql: string,
    bind?: Record<string, SqlRowValue>,
  ) => Promise<SqlRow[]>;
  isAuthenticated: boolean;
  log: ReturnType<typeof useLog>["log"];
  online: boolean;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: PropsWithChildren) {
  const apiClient = useApiClient();
  const { online } = useNetworkState();
  const { client: dbClient, id: dbId, status: dbStatus } = useDatabase();
  const { encapsulationKeyPair, authToken, containerId, isAuthenticated } =
    useCryptoSession();
  const { events } = useEvents();
  const { log } = useLog();
  const domainScopeRef = useRef({});

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

  const value = useMemo(
    () => ({
      apiClient,
      authToken,
      containerId,
      dbId,
      dbStatus,
      domainScope: domainScopeRef.current,
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
      containerId,
      dbId,
      dbStatus,
      domainScopeRef,
      encapsulationKeyPair,
      events,
      execSql,
      isAuthenticated,
      log,
      online,
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
