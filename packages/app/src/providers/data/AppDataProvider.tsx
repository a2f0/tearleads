import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { useNetworkState } from "../api/NetworkStateProvider";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { useDatabase } from "../db/DatabaseProvider";
import { useEvents } from "../events/EventsProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useTearleads } from "../sdk/TearleadsProvider";

type SdkWorkflowRuntimeInput = ReturnType<
  ReturnType<typeof useTearleads>["runtime"]["input"]
>;

export interface AppDataContextValue extends SdkWorkflowRuntimeInput {
  authToken: string | null;
  dbId: string | null;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { online } = useNetworkState();
  const { client: dbClient, id: dbId, status: dbStatus } = useDatabase();
  const { authToken, containerId, isAuthenticated, organizationId, userId } =
    useCryptoSession();
  const { encapsulationKeyPair, signingFingerprint, signingKeyPair } =
    useIdentity();
  const { events } = useEvents();
  const runtimeInput = useMemo(
    () => tearleads.runtime.input(containerId),
    [
      containerId,
      dbClient,
      dbId,
      dbStatus,
      encapsulationKeyPair,
      events,
      isAuthenticated,
      online,
      organizationId,
      signingFingerprint,
      signingKeyPair,
      tearleads,
      userId,
    ],
  );

  const value = useMemo(
    () => ({
      authToken,
      dbId,
      ...runtimeInput,
    }),
    [authToken, dbId, runtimeInput],
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
