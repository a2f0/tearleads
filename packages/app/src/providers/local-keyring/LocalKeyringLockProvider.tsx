import { createBrowserLocalKeyringManifestStore } from "@tearleads/client-sdk";
import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import {
  type LocalKeyringLockContextValue,
  useClearPinCodeAction,
  useDynamicLocalKeyringFactory,
  useLocalKeyringLockContextValue,
  useLockAction,
  useSetPinCodeAction,
  useUnlockAction,
} from "./localKeyringLockActions";
import {
  getBrowserStorage,
  hasPinWrappedManifest,
  initialLockSnapshot,
  isBrowserKeyringSupported,
  type LocalKeyringLockEnvironment,
  type LockState,
  pinCodeConfigKey,
} from "./localKeyringLockSupport";
import { appLocalKeyringScopes } from "./localKeyringScopes";

interface LocalKeyringLockRuntime {
  readonly lockState: LockState;
  readonly refresh: () => Promise<void>;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
  readonly unlockedPinCode: string | null;
}

const LocalKeyringLockContext =
  createContext<LocalKeyringLockContextValue | null>(null);
const DEFAULT_PIN_CODE_CONFIG_NAMESPACE = "default";

function useLocalKeyringLockEnvironment(): LocalKeyringLockEnvironment {
  const hostConfig = useAppHostConfig();
  const storage = useMemo(() => getBrowserStorage(), []);
  const localIdentityNamespace = hostConfig.localIdentityNamespace ?? null;
  const hostCreateLocalKeyring = hostConfig.createLocalKeyring;
  const keyMaterialStorage = hostConfig.localKeyringKeyMaterialStorage;
  // A host that supplies its own keyring owns wrapping entirely, so this
  // provider has nothing to re-wrap and PIN locking cannot apply. A host that
  // only declares a key-material mode (the WebView shells) still gets its
  // keyring built here, so it keeps PIN locking.
  const hostManaged = hostCreateLocalKeyring !== undefined;
  const canManagePinCode = !hostManaged && isBrowserKeyringSupported(storage);
  const pinCodeConfigNamespace = canManagePinCode
    ? (localIdentityNamespace ?? DEFAULT_PIN_CODE_CONFIG_NAMESPACE)
    : null;
  const manifestStore = useMemo(
    () => (canManagePinCode ? createBrowserLocalKeyringManifestStore() : null),
    [canManagePinCode],
  );
  const scopes = useMemo(
    () => appLocalKeyringScopes(localIdentityNamespace),
    [localIdentityNamespace],
  );

  return useMemo(
    () => ({
      canManagePinCode,
      hostCreateLocalKeyring,
      keyMaterialStorage,
      manifestStore,
      pinCodeConfigNamespace,
      scopes,
      storage,
    }),
    [
      canManagePinCode,
      hostCreateLocalKeyring,
      keyMaterialStorage,
      manifestStore,
      pinCodeConfigNamespace,
      scopes,
      storage,
    ],
  );
}

function useLocalKeyringLockRuntime(
  environment: LocalKeyringLockEnvironment,
): LocalKeyringLockRuntime {
  const [unlockedPinCode, setUnlockedPinCode] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>(() => ({
    ...initialLockSnapshot({
      hostManaged: environment.hostCreateLocalKeyring !== undefined,
      namespace: environment.pinCodeConfigNamespace,
      storage: environment.storage,
    }),
    revision: 0,
  }));
  const latestRefreshId = useRef(0);

  const refresh = useCallback(async () => {
    const refreshId = latestRefreshId.current + 1;
    latestRefreshId.current = refreshId;

    // Revision is also the cache identity for the live keyring. Advancing it
    // for an unchanged refresh would close IndexedDB underneath concurrent
    // startup work such as identity restore and SQLite key derivation.
    if (
      !environment.canManagePinCode ||
      !environment.manifestStore ||
      !environment.pinCodeConfigNamespace
    ) {
      setLockState((current) =>
        !current.pinCodeEnabled && current.status === "unavailable"
          ? current
          : {
              pinCodeEnabled: false,
              revision: current.revision + 1,
              status: "unavailable",
            },
      );
      return;
    }

    const enabled = await hasPinWrappedManifest({
      manifestStore: environment.manifestStore,
      scopes: environment.scopes,
    });
    if (refreshId !== latestRefreshId.current) {
      return;
    }

    if (!enabled) {
      environment.storage?.removeItem(
        pinCodeConfigKey(environment.pinCodeConfigNamespace),
      );
    }

    const status = enabled && !unlockedPinCode ? "locked" : "unlocked";
    setLockState((current) =>
      current.pinCodeEnabled === enabled && current.status === status
        ? current
        : {
            pinCodeEnabled: enabled,
            revision: current.revision + 1,
            status,
          },
    );
  }, [environment, unlockedPinCode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    lockState,
    refresh,
    setLockState,
    setUnlockedPinCode,
    unlockedPinCode,
  };
}

export function LocalKeyringLockProvider({ children }: PropsWithChildren) {
  const environment = useLocalKeyringLockEnvironment();
  const runtime = useLocalKeyringLockRuntime(environment);
  const createLocalKeyring = useDynamicLocalKeyringFactory({
    environment,
    lockState: runtime.lockState,
    unlockedPinCode: runtime.unlockedPinCode,
  });
  const unlock = useUnlockAction({
    environment,
    setLockState: runtime.setLockState,
    setUnlockedPinCode: runtime.setUnlockedPinCode,
  });
  const lock = useLockAction({
    lockState: runtime.lockState,
    setLockState: runtime.setLockState,
    setUnlockedPinCode: runtime.setUnlockedPinCode,
  });
  const setPinCode = useSetPinCodeAction({
    environment,
    setLockState: runtime.setLockState,
    setUnlockedPinCode: runtime.setUnlockedPinCode,
    unlockedPinCode: runtime.unlockedPinCode,
  });
  const clearPinCode = useClearPinCodeAction({
    environment,
    setLockState: runtime.setLockState,
    setUnlockedPinCode: runtime.setUnlockedPinCode,
  });

  const value = useLocalKeyringLockContextValue({
    clearPinCode,
    createLocalKeyring,
    environment,
    lock,
    lockState: runtime.lockState,
    refresh: runtime.refresh,
    setPinCode,
    unlock,
  });

  return (
    <LocalKeyringLockContext.Provider value={value}>
      {children}
    </LocalKeyringLockContext.Provider>
  );
}

export function useLocalKeyringLock(): LocalKeyringLockContextValue {
  const context = useContext(LocalKeyringLockContext);
  if (!context) {
    throw new Error(
      "useLocalKeyringLock must be used within LocalKeyringLockProvider.",
    );
  }

  return context;
}
