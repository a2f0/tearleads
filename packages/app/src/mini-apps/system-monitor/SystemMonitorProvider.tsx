import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { usePaneSide } from "../../components/pane/dual-pane/usePaneSide";
import { useSystemMonitorDeveloperMode } from "./systemMonitorDeveloperMode";
import {
  DEFAULT_SYSTEM_MONITOR_MODE,
  loadSystemMonitorMode,
  type SystemMonitorMode,
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "./systemMonitorMode";

interface SystemMonitorContextValue {
  // canPin is true only when a real pane-level provider is mounted. It stays
  // false for the default context value so isolated renders do not persist
  // monitor placement.
  canPin: boolean;
  isDeveloperMode: boolean;
  isPinned: boolean;
  mode: SystemMonitorMode;
  pinToDesktop: () => void;
  toggleDeveloperMode: () => void;
  unpinToWindow: () => void;
}

const SystemMonitorContext = createContext<SystemMonitorContextValue>({
  canPin: false,
  isDeveloperMode: false,
  isPinned: false,
  mode: DEFAULT_SYSTEM_MONITOR_MODE,
  pinToDesktop: () => {},
  toggleDeveloperMode: () => {},
  unpinToWindow: () => {},
});

export function SystemMonitorProvider({ children }: PropsWithChildren) {
  const side = usePaneSide();
  const storageKey = useMemo(() => systemMonitorModeStorageKey(side), [side]);
  const [mode, setMode] = useState<SystemMonitorMode>(() =>
    loadSystemMonitorMode(storageKey),
  );
  const { isDeveloperMode, toggleDeveloperMode } =
    useSystemMonitorDeveloperMode();

  // Persist on the user's action only — never on mount — so a fresh load
  // leaves storage untouched until the monitor is actually pinned/unpinned.
  const pinToDesktop = useCallback(() => {
    setMode("pinned");
    saveSystemMonitorMode(storageKey, "pinned");
  }, [storageKey]);
  const unpinToWindow = useCallback(() => {
    setMode("windowed");
    saveSystemMonitorMode(storageKey, "windowed");
  }, [storageKey]);

  const value = useMemo<SystemMonitorContextValue>(
    () => ({
      canPin: true,
      isDeveloperMode,
      isPinned: mode === "pinned",
      mode,
      pinToDesktop,
      toggleDeveloperMode,
      unpinToWindow,
    }),
    [isDeveloperMode, mode, pinToDesktop, toggleDeveloperMode, unpinToWindow],
  );

  return (
    <SystemMonitorContext.Provider value={value}>
      {children}
    </SystemMonitorContext.Provider>
  );
}

export function useSystemMonitor(): SystemMonitorContextValue {
  return useContext(SystemMonitorContext);
}
