import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../utils/storedPreference";

type DeveloperModeSetting = "disabled" | "enabled";

/** System Monitor introduced the setting; keep its key so it persists. */
export function developerModeStorageKey(): string {
  return "tearleads.system-monitor:developer-mode";
}

function isDeveloperModeSetting(
  value: string | null,
): value is DeveloperModeSetting {
  return value === "disabled" || value === "enabled";
}

export function loadDeveloperMode(): DeveloperModeSetting {
  return loadStoredPreference(developerModeStorageKey(), (stored) =>
    isDeveloperModeSetting(stored) ? stored : "disabled",
  );
}

export function saveDeveloperMode(mode: DeveloperModeSetting): void {
  saveStoredPreference(developerModeStorageKey(), mode);
}

interface DeveloperModeValue {
  isDeveloperMode: boolean;
  toggleDeveloperMode: () => void;
}

const DeveloperModeContext = createContext<DeveloperModeValue | null>(null);

/** Per-device developer mode shared by System Monitor and other mini-apps. */
export function DeveloperModeProvider({ children }: PropsWithChildren) {
  const [developerMode, setDeveloperMode] = useState(loadDeveloperMode);
  const toggleDeveloperMode = useCallback(() => {
    setDeveloperMode((currentMode) => {
      const nextMode = currentMode === "enabled" ? "disabled" : "enabled";
      saveDeveloperMode(nextMode);
      return nextMode;
    });
  }, []);
  const value = useMemo<DeveloperModeValue>(
    () => ({
      isDeveloperMode: developerMode === "enabled",
      toggleDeveloperMode,
    }),
    [developerMode, toggleDeveloperMode],
  );

  return (
    <DeveloperModeContext.Provider value={value}>
      {children}
    </DeveloperModeContext.Provider>
  );
}

export function useDeveloperMode(): DeveloperModeValue {
  const context = useContext(DeveloperModeContext);
  if (!context) {
    throw new Error(
      "useDeveloperMode must be used within a DeveloperModeProvider.",
    );
  }
  return context;
}
