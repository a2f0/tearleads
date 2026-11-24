import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  APP_FEATURE_FLAG_IDS,
  type AppFeatureFlagId,
  type AppFeatureFlagMode,
  appFeatureFlagStorageKey,
  clearAppFeatureFlag,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

interface AppFeatureFlagsValue {
  isEnabled: (flag: AppFeatureFlagId) => boolean;
  /** Forgets every choice made on this device, so each flag reads its default. */
  resetToDefaults: () => void;
  setEnabled: (flag: AppFeatureFlagId, enabled: boolean) => void;
}

const NO_APP_FEATURE_FLAGS: AppFeatureFlagsValue = {
  isEnabled: () => false,
  resetToDefaults: () => {},
  setEnabled: () => {},
};

const AppFeatureFlagsContext =
  createContext<AppFeatureFlagsValue>(NO_APP_FEATURE_FLAGS);

function featureFlagModeFromEnabled(enabled: boolean): AppFeatureFlagMode {
  return enabled ? "enabled" : "disabled";
}

function loadEnabledAppFeatureFlags(): ReadonlySet<AppFeatureFlagId> {
  return new Set(
    APP_FEATURE_FLAG_IDS.filter(
      (flag) => loadAppFeatureFlag(flag) === "enabled",
    ),
  );
}

function usePersistentAppFeatureFlags(): AppFeatureFlagsValue {
  const [enabledFlags, setEnabledFlags] = useState(loadEnabledAppFeatureFlags);
  const isEnabled = useCallback(
    (flag: AppFeatureFlagId) => enabledFlags.has(flag),
    [enabledFlags],
  );
  const setEnabled = useCallback((flag: AppFeatureFlagId, enabled: boolean) => {
    setEnabledFlags((current) => {
      if (current.has(flag) === enabled) {
        return current;
      }

      const next = new Set(current);
      if (enabled) {
        next.add(flag);
      } else {
        next.delete(flag);
      }
      return next;
    });
    saveAppFeatureFlag(
      appFeatureFlagStorageKey(flag),
      featureFlagModeFromEnabled(enabled),
    );
  }, []);
  // Cleared rather than saved as each default, so a flag whose default later
  // changes follows it. The flags are then reread: storage that would not clear
  // still holds the choice, and the switches should say so.
  const resetToDefaults = useCallback(() => {
    for (const flag of APP_FEATURE_FLAG_IDS) {
      clearAppFeatureFlag(flag);
    }
    setEnabledFlags(loadEnabledAppFeatureFlags());
  }, []);

  return useMemo(
    () => ({ isEnabled, resetToDefaults, setEnabled }),
    [isEnabled, resetToDefaults, setEnabled],
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
  if (existingContext !== NO_APP_FEATURE_FLAGS) {
    return <>{children}</>;
  }

  return (
    <AppFeatureFlagsProviderInner>{children}</AppFeatureFlagsProviderInner>
  );
}

export function useAppFeatureFlags(): AppFeatureFlagsValue {
  return useContext(AppFeatureFlagsContext);
}
