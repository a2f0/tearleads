import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
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
  const runtimeVersion = useSyncExternalStore(
    tearleads.runtime.subscribe,
    () => tearleads.runtime.version,
    () => tearleads.runtime.version,
  );
  const runtimeInput = useMemo(
    () => tearleads.runtime.input(),
    [runtimeVersion, tearleads],
  );

  const value = useMemo(
    () => ({
      authToken: tearleads.session.authToken,
      dbId: tearleads.database.id,
      ...runtimeInput,
    }),
    [runtimeInput, tearleads],
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
