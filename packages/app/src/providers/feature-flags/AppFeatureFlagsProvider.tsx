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
  passkeysEnabled: boolean;
  setBuiltInSystemContainersVisible: (enabled: boolean) => void;
  setLinkedDocumentActivationControlsEnabled: (enabled: boolean) => void;
  setPasskeysEnabled: (enabled: boolean) => void;
  toggleBuiltInSystemContainers: () => void;
  toggleLinkedDocumentActivationControls: () => void;
  togglePasskeys: () => void;
}

const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlagsValue = {
  builtInSystemContainersVisible: false,
  linkedDocumentActivationControlsEnabled: false,
  passkeysEnabled: false,
  setBuiltInSystemContainersVisible: () => {},
  setLinkedDocumentActivationControlsEnabled: () => {},
  setPasskeysEnabled: () => {},
  toggleBuiltInSystemContainers: () => {},
  toggleLinkedDocumentActivationControls: () => {},
  togglePasskeys: () => {},
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
  const passkeys = usePersistentAppFeatureFlag("passkeys");
  const linkedDocumentActivationControls = usePersistentAppFeatureFlag(
    "linked-document-activation-controls",
  );

  return useMemo(
    () => ({
      builtInSystemContainersVisible: builtInSystemContainers.enabled,
      linkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.enabled,
      passkeysEnabled: passkeys.enabled,
      setBuiltInSystemContainersVisible: builtInSystemContainers.setEnabled,
      setLinkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.setEnabled,
      setPasskeysEnabled: passkeys.setEnabled,
      toggleBuiltInSystemContainers: builtInSystemContainers.toggle,
      toggleLinkedDocumentActivationControls:
        linkedDocumentActivationControls.toggle,
      togglePasskeys: passkeys.toggle,
    }),
    [
      builtInSystemContainers.enabled,
      builtInSystemContainers.setEnabled,
      builtInSystemContainers.toggle,
      linkedDocumentActivationControls.enabled,
      linkedDocumentActivationControls.setEnabled,
      linkedDocumentActivationControls.toggle,
      passkeys.enabled,
      passkeys.setEnabled,
      passkeys.toggle,
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
