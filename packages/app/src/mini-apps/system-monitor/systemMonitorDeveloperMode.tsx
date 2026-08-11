import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  loadSystemMonitorDeveloperMode,
  saveSystemMonitorDeveloperMode,
  systemMonitorDeveloperModeStorageKey,
} from "./systemMonitorMode";

interface SystemMonitorDeveloperModeValue {
  isDeveloperMode: boolean;
  toggleDeveloperMode: () => void;
}

const SystemMonitorDeveloperModeContext =
  createContext<SystemMonitorDeveloperModeValue | null>(null);

function usePersistentSystemMonitorDeveloperMode() {
  const [developerMode, setDeveloperMode] = useState(() =>
    loadSystemMonitorDeveloperMode(systemMonitorDeveloperModeStorageKey()),
  );
  const toggleDeveloperMode = useCallback(() => {
    setDeveloperMode((currentMode) => {
      const nextMode = currentMode === "enabled" ? "disabled" : "enabled";
      saveSystemMonitorDeveloperMode(
        systemMonitorDeveloperModeStorageKey(),
        nextMode,
      );
      return nextMode;
    });
  }, []);

  return useMemo<SystemMonitorDeveloperModeValue>(
    () => ({
      isDeveloperMode: developerMode === "enabled",
      toggleDeveloperMode,
    }),
    [developerMode, toggleDeveloperMode],
  );
}

export function SystemMonitorDeveloperModeProvider({
  children,
}: PropsWithChildren) {
  const value = usePersistentSystemMonitorDeveloperMode();

  return (
    <SystemMonitorDeveloperModeContext.Provider value={value}>
      {children}
    </SystemMonitorDeveloperModeContext.Provider>
  );
}

export function useSystemMonitorDeveloperMode(): SystemMonitorDeveloperModeValue {
  const context = useContext(SystemMonitorDeveloperModeContext);
  if (!context) {
    throw new Error(
      "useSystemMonitorDeveloperMode must be used within a SystemMonitorDeveloperModeProvider.",
    );
  }
  return context;
}
