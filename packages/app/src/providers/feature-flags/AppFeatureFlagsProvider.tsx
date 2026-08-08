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
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

interface AppFeatureFlagsValue {
  isEnabled: (flag: AppFeatureFlagId) => boolean;
  setEnabled: (flag: AppFeatureFlagId, enabled: boolean) => void;
}

const NO_APP_FEATURE_FLAGS: AppFeatureFlagsValue = {
  isEnabled: () => false,
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
      (flag) =>
        loadAppFeatureFlag(appFeatureFlagStorageKey(flag)) === "enabled",
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

  return useMemo(() => ({ isEnabled, setEnabled }), [isEnabled, setEnabled]);
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
