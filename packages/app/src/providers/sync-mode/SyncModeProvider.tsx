import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  loadSyncMode,
  type SyncMode,
  saveSyncMode,
} from "./syncModePreference";

interface SyncModeContextValue {
  /** The persisted user preference ("sync" replicates, "local-only" stays on-device). */
  readonly mode: SyncMode;
  /** Convenience boolean: whether sync mode is selected (`mode === "sync"`). */
  readonly syncEnabled: boolean;
  /** Choose a mode; persisted and pushed into the SDK by {@link TearleadsProvider}. */
  readonly setMode: (mode: SyncMode) => void;
}

const SyncModeContext = createContext<SyncModeContextValue | null>(null);

/**
 * Owns the local-only vs sync mode preference. Kept above `TearleadsProvider`
 * (pure React state, no SDK dependency) so the SDK bridge and the events
 * WebSocket gate can consume it; the preference persists across reloads.
 *
 * This provider only records *intent*. `TearleadsProvider` mirrors it onto
 * `session.setSyncEnabled`, which the resolved runtime `state.online` folds in
 * so every server-sync path pauses in local-only mode. Actual replication also
 * requires being signed in and online, and the server enforces org billing.
 */
export function SyncModeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<SyncMode>(loadSyncMode);

  const setMode = useCallback((next: SyncMode) => {
    setModeState(next);
    saveSyncMode(next);
  }, []);

  const value = useMemo<SyncModeContextValue>(
    () => ({ mode, setMode, syncEnabled: mode === "sync" }),
    [mode, setMode],
  );

  return (
    <SyncModeContext.Provider value={value}>
      {children}
    </SyncModeContext.Provider>
  );
}

export function useSyncMode(): SyncModeContextValue {
  const context = useContext(SyncModeContext);
  if (!context) {
    throw new Error("useSyncMode must be used within a SyncModeProvider.");
  }
  return context;
}
