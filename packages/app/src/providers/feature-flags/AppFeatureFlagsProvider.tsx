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
  documentEditRangesVisible: boolean;
  explorerHeaderSyncIndicatorVisible: boolean;
  linkedDocumentActivationControlsEnabled: boolean;
  workspaceSwitcherVisible: boolean;
  setBuiltInSystemContainersVisible: (enabled: boolean) => void;
  setDocumentEditRangesVisible: (enabled: boolean) => void;
  setExplorerHeaderSyncIndicatorVisible: (enabled: boolean) => void;
  setLinkedDocumentActivationControlsEnabled: (enabled: boolean) => void;
  setWorkspaceSwitcherVisible: (enabled: boolean) => void;
}

const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlagsValue = {
  builtInSystemContainersVisible: false,
  documentEditRangesVisible: false,
  explorerHeaderSyncIndicatorVisible: false,
  linkedDocumentActivationControlsEnabled: false,
  workspaceSwitcherVisible: false,
  setBuiltInSystemContainersVisible: () => {},
  setDocumentEditRangesVisible: () => {},
  setExplorerHeaderSyncIndicatorVisible: () => {},
  setLinkedDocumentActivationControlsEnabled: () => {},
  setWorkspaceSwitcherVisible: () => {},
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

  return {
    enabled: mode === "enabled",
    setEnabled,
  };
}

function usePersistentAppFeatureFlags(): AppFeatureFlagsValue {
  const builtInSystemContainers = usePersistentAppFeatureFlag(
    "built-in-system-containers",
  );
  const documentEditRanges = usePersistentAppFeatureFlag(
    "document-edit-ranges",
  );
  const explorerHeaderSyncIndicator = usePersistentAppFeatureFlag(
    "explorer-header-sync-indicator",
  );
  const linkedDocumentActivationControls = usePersistentAppFeatureFlag(
    "linked-document-activation-controls",
  );
  const workspaceSwitcher = usePersistentAppFeatureFlag("workspace-switcher");

  return useMemo(
    () => ({
      builtInSystemContainersVisible: builtInSystemContainers.enabled,
      documentEditRangesVisible: documentEditRanges.enabled,
      explorerHeaderSyncIndicatorVisible: explorerHeaderSyncIndicator.enabled,
      linkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.enabled,
      workspaceSwitcherVisible: workspaceSwitcher.enabled,
      setBuiltInSystemContainersVisible: builtInSystemContainers.setEnabled,
      setDocumentEditRangesVisible: documentEditRanges.setEnabled,
      setExplorerHeaderSyncIndicatorVisible:
        explorerHeaderSyncIndicator.setEnabled,
      setLinkedDocumentActivationControlsEnabled:
        linkedDocumentActivationControls.setEnabled,
      setWorkspaceSwitcherVisible: workspaceSwitcher.setEnabled,
    }),
    [
      builtInSystemContainers.enabled,
      builtInSystemContainers.setEnabled,
      documentEditRanges.enabled,
      documentEditRanges.setEnabled,
      explorerHeaderSyncIndicator.enabled,
      explorerHeaderSyncIndicator.setEnabled,
      linkedDocumentActivationControls.enabled,
      linkedDocumentActivationControls.setEnabled,
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
