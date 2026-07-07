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
  linkedDocumentActivationControlsEnabled: boolean;
  passkeysEnabled: boolean;
  setLinkedDocumentActivationControlsEnabled: (enabled: boolean) => void;
  setPasskeysEnabled: (enabled: boolean) => void;
  toggleLinkedDocumentActivationControls: () => void;
  togglePasskeys: () => void;
}

const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlagsValue = {
  linkedDocumentActivationControlsEnabled: false,
  passkeysEnabled: false,
  setLinkedDocumentActivationControlsEnabled: () => {},
  setPasskeysEnabled: () => {},
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
    setMode((currentMode) => {
      const nextMode = currentMode === "enabled" ? "disabled" : "enabled";
      saveAppFeatureFlag(storageKey, nextMode);
      return nextMode;
    });
  }, [storageKey]);

  return {
    enabled: mode === "enabled",
    setEnabled,
    toggle,
  };
}

function usePersistentAppFeatureFlags(): AppFeatureFlagsValue {
  const passkeys = usePersistentAppFeatureFlag("passkeys");
  const linkedDocumentActivationControls = usePersistentAppFeatureFlag(
    "linked-document-activation-controls",
  );

  return useMemo(
    () => ({
      linkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.enabled,
      passkeysEnabled: passkeys.enabled,
      setLinkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.setEnabled,
      setPasskeysEnabled: passkeys.setEnabled,
      toggleLinkedDocumentActivationControls:
        linkedDocumentActivationControls.toggle,
      togglePasskeys: passkeys.toggle,
    }),
    [
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
