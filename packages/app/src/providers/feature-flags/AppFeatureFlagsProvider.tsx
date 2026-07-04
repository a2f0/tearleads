import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  type AppFeatureFlagMode,
  appFeatureFlagStorageKey,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

interface AppFeatureFlagsValue {
  passkeysEnabled: boolean;
  setPasskeysEnabled: (enabled: boolean) => void;
  togglePasskeys: () => void;
}

const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlagsValue = {
  passkeysEnabled: false,
  setPasskeysEnabled: () => {},
  togglePasskeys: () => {},
};

const AppFeatureFlagsContext = createContext<AppFeatureFlagsValue | null>(null);

function featureFlagModeFromEnabled(enabled: boolean): AppFeatureFlagMode {
  return enabled ? "enabled" : "disabled";
}

function usePersistentAppFeatureFlags(): AppFeatureFlagsValue {
  const [passkeysMode, setPasskeysMode] = useState(() =>
    loadAppFeatureFlag(appFeatureFlagStorageKey("passkeys")),
  );
  const setPasskeysEnabled = useCallback((enabled: boolean) => {
    const nextMode = featureFlagModeFromEnabled(enabled);
    setPasskeysMode(nextMode);
    saveAppFeatureFlag(appFeatureFlagStorageKey("passkeys"), nextMode);
  }, []);
  const togglePasskeys = useCallback(() => {
    setPasskeysMode((currentMode) => {
      const nextMode = currentMode === "enabled" ? "disabled" : "enabled";
      saveAppFeatureFlag(appFeatureFlagStorageKey("passkeys"), nextMode);
      return nextMode;
    });
  }, []);

  return useMemo(
    () => ({
      passkeysEnabled: passkeysMode === "enabled",
      setPasskeysEnabled,
      togglePasskeys,
    }),
    [passkeysMode, setPasskeysEnabled, togglePasskeys],
  );
}

function AppFeatureFlagsProviderInner({ children }: PropsWithChildren) {
  const value = usePersistentAppFeatureFlags();

  return (
    <AppFeatureFlagsContext.Provider value={value}>
      {children}
    </AppFeatureFlagsContext.Provider>
  );
}

export function AppFeatureFlagsProvider({ children }: PropsWithChildren) {
  const existingContext = useContext(AppFeatureFlagsContext);
  if (existingContext) {
    return <>{children}</>;
  }

  return (
    <AppFeatureFlagsProviderInner>{children}</AppFeatureFlagsProviderInner>
  );
}

export function useAppFeatureFlags(): AppFeatureFlagsValue {
  return useContext(AppFeatureFlagsContext) ?? DEFAULT_APP_FEATURE_FLAGS;
}
