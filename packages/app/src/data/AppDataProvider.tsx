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
import { useLog } from "../logging/LogProvider";

export type SqlRowValue = string | number | null;
export type SqlRow = Record<string, SqlRowValue>;

interface AppDataContextValue {
  apiClient: ReturnType<typeof useApiClient>;
  authToken: string | null;
  dbId: string | null;
  dbStatus: ReturnType<typeof useDatabase>["status"];
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
  const { encapsulationKeyPair, authToken, isAuthenticated } =
    useCryptoSession();
  const { events } = useEvents();
  const { log } = useLog();

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
      dbId,
      dbStatus,
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
      dbId,
      dbStatus,
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
