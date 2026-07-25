import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  type AppFeatureFlagId,
  type AppFeatureFlagMode,
  appFeatureFlagStorageKey,
  loadAppFeatureFlag,
  saveAppFeatureFlag,
} from "./appFeatureFlags";

interface AppFeatureFlagsValue {
  builtInSystemContainersVisible: boolean;
  linkedDocumentActivationControlsEnabled: boolean;
  workspaceSwitcherVisible: boolean;
  setBuiltInSystemContainersVisible: (enabled: boolean) => void;
  setLinkedDocumentActivationControlsEnabled: (enabled: boolean) => void;
  setWorkspaceSwitcherVisible: (enabled: boolean) => void;
  toggleBuiltInSystemContainers: () => void;
  toggleLinkedDocumentActivationControls: () => void;
}

const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlagsValue = {
  builtInSystemContainersVisible: false,
  linkedDocumentActivationControlsEnabled: false,
  workspaceSwitcherVisible: false,
  setBuiltInSystemContainersVisible: () => {},
  setLinkedDocumentActivationControlsEnabled: () => {},
  setWorkspaceSwitcherVisible: () => {},
  toggleBuiltInSystemContainers: () => {},
  toggleLinkedDocumentActivationControls: () => {},
};

const AppFeatureFlagsContext = createContext<AppFeatureFlagsValue | null>(null);

function featureFlagModeFromEnabled(enabled: boolean): AppFeatureFlagMode {
  return enabled ? "enabled" : "disabled";
}

function usePersistentAppFeatureFlag(flag: AppFeatureFlagId) {
  const storageKey = appFeatureFlagStorageKey(flag);
  const [mode, setMode] = useState(() => loadAppFeatureFlag(storageKey));
  const setEnabled = useCallback(
    (enabled: boolean) => {
      const nextMode = featureFlagModeFromEnabled(enabled);
      setMode(nextMode);
      saveAppFeatureFlag(storageKey, nextMode);
    },
    [storageKey],
  );
  const toggle = useCallback(() => {
    const nextMode = mode === "enabled" ? "disabled" : "enabled";
    setMode(nextMode);
    saveAppFeatureFlag(storageKey, nextMode);
  }, [mode, storageKey]);

  return {
    enabled: mode === "enabled",
    setEnabled,
    toggle,
  };
}

function usePersistentAppFeatureFlags(): AppFeatureFlagsValue {
  const builtInSystemContainers = usePersistentAppFeatureFlag(
    "built-in-system-containers",
  );
  const linkedDocumentActivationControls = usePersistentAppFeatureFlag(
    "linked-document-activation-controls",
  );
  const workspaceSwitcher = usePersistentAppFeatureFlag("workspace-switcher");

  return useMemo(
    () => ({
      builtInSystemContainersVisible: builtInSystemContainers.enabled,
      linkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.enabled,
      workspaceSwitcherVisible: workspaceSwitcher.enabled,
      setBuiltInSystemContainersVisible: builtInSystemContainers.setEnabled,
      setLinkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.setEnabled,
      setWorkspaceSwitcherVisible: workspaceSwitcher.setEnabled,
      toggleBuiltInSystemContainers: builtInSystemContainers.toggle,
      toggleLinkedDocumentActivationControls:
        linkedDocumentActivationControls.toggle,
    }),
    [
      builtInSystemContainers.enabled,
      builtInSystemContainers.setEnabled,
      builtInSystemContainers.toggle,
      linkedDocumentActivationControls.enabled,
      linkedDocumentActivationControls.setEnabled,
      linkedDocumentActivationControls.toggle,
      workspaceSwitcher.enabled,
      workspaceSwitcher.setEnabled,
    ],
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
