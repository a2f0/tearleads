import {
  createLocalStorageLocalKeyringManifestStore,
  type LocalKeyring,
  type LocalKeyringManifestStore,
  type LocalKeyringScope,
} from "@tearleads/client-sdk";
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
  type BrowserStorage,
  createBrowserLocalKeyringForPinCode,
  createDynamicLocalKeyring,
  createPinKeystore,
  createPlainKeystore,
  getBrowserStorage,
  hasPinWrappedManifest,
  initialLockSnapshot,
  isBrowserKeyringSupported,
  type LocalKeyringLockStatus,
  type LockSnapshot,
  pinCodeConfigKey,
  rewrapExistingManifests,
  verifyPinCode,
} from "./localKeyringLockSupport";
import { appLocalKeyringScopes } from "./localKeyringScopes";

interface LocalKeyringLockContextValue {
  readonly canManagePinCode: boolean;
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly isLocked: boolean;
  readonly pinCodeEnabled: boolean;
  readonly revision: number;
  readonly status: LocalKeyringLockStatus;
  clearPinCode(pinCode: string): Promise<boolean>;
  lock(): boolean;
  refresh(): Promise<void>;
  setPinCode(pinCode: string): Promise<boolean>;
  unlock(pinCode: string): Promise<boolean>;
}

interface LockState extends LockSnapshot {
  readonly revision: number;
}

interface LocalKeyringLockEnvironment {
  readonly canManagePinCode: boolean;
  readonly hostCreateLocalKeyring: (() => LocalKeyring) | undefined;
  readonly manifestStore: LocalKeyringManifestStore | null;
  readonly pinCodeConfigNamespace: string | null;
  readonly scopes: readonly LocalKeyringScope[];
  readonly storage: BrowserStorage | null;
}

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
  const hostManaged = hostCreateLocalKeyring !== undefined;
  const canManagePinCode = !hostManaged && isBrowserKeyringSupported(storage);
  const pinCodeConfigNamespace = canManagePinCode
    ? (localIdentityNamespace ?? DEFAULT_PIN_CODE_CONFIG_NAMESPACE)
    : null;
  const manifestStore = useMemo(
    () =>
      canManagePinCode ? createLocalStorageLocalKeyringManifestStore() : null,
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
      manifestStore,
      pinCodeConfigNamespace,
      scopes,
      storage,
    }),
    [
      canManagePinCode,
      hostCreateLocalKeyring,
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

    if (
      !environment.canManagePinCode ||
      !environment.manifestStore ||
      !environment.pinCodeConfigNamespace
    ) {
      setLockState((current) => ({
        pinCodeEnabled: false,
        revision: current.revision + 1,
        status: "unavailable",
      }));
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

    setLockState((current) => ({
      pinCodeEnabled: enabled,
      revision: current.revision + 1,
      status: enabled && !unlockedPinCode ? "locked" : "unlocked",
    }));
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

async function rewrapExistingManifestsWithPin(input: {
  readonly manifestStore: LocalKeyringManifestStore;
  readonly pinCode: string;
  readonly scopes: readonly LocalKeyringScope[];
  readonly sourcePinCode: string | null;
}): Promise<boolean> {
  await rewrapExistingManifests({
    manifestStore: input.manifestStore,
    scopes: input.scopes,
    sourcePinCode: input.sourcePinCode,
    targetKeystore: createPinKeystore(input.pinCode),
  });

  return hasPinWrappedManifest({
    manifestStore: input.manifestStore,
    scopes: input.scopes,
  });
}

function useDynamicLocalKeyringFactory(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly lockState: LockState;
  readonly unlockedPinCode: string | null;
}): () => LocalKeyring {
  const stateRef = useRef({
    canManagePinCode: input.environment.canManagePinCode,
    hostCreateLocalKeyring: input.environment.hostCreateLocalKeyring,
    pinCodeEnabled: input.lockState.pinCodeEnabled,
    unlockedPinCode: input.unlockedPinCode,
  });
  stateRef.current = {
    canManagePinCode: input.environment.canManagePinCode,
    hostCreateLocalKeyring: input.environment.hostCreateLocalKeyring,
    pinCodeEnabled: input.lockState.pinCodeEnabled,
    unlockedPinCode: input.unlockedPinCode,
  };

  return useCallback((): LocalKeyring => {
    return createDynamicLocalKeyring(() => {
      const current = stateRef.current;
      if (current.hostCreateLocalKeyring) {
        return current.hostCreateLocalKeyring();
      }
      if (!current.canManagePinCode) {
        return null;
      }
      if (!current.pinCodeEnabled) {
        return createBrowserLocalKeyringForPinCode(null);
      }
      if (!current.unlockedPinCode) {
        return null;
      }

      return createBrowserLocalKeyringForPinCode(current.unlockedPinCode);
    });
  }, []);
}

function useUnlockAction(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
}): (pinCode: string) => Promise<boolean> {
  return useCallback(
    async (pinCode: string): Promise<boolean> => {
      if (
        !input.environment.canManagePinCode ||
        !input.environment.manifestStore ||
        !input.environment.pinCodeConfigNamespace ||
        !pinCode
      ) {
        return false;
      }

      let verified = false;
      try {
        verified = await verifyPinCode({
          manifestStore: input.environment.manifestStore,
          pinCode,
          scopes: input.environment.scopes,
        });
      } catch {
        return false;
      }
      if (!verified) {
        return false;
      }

      input.setUnlockedPinCode(pinCode);
      input.setLockState((current) => ({
        pinCodeEnabled: true,
        revision: current.revision + 1,
        status: "unlocked",
      }));
      return true;
    },
    [input],
  );
}

function useLockAction(input: {
  readonly lockState: LockState;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
}): () => boolean {
  const { lockState, setLockState, setUnlockedPinCode } = input;
  return useCallback((): boolean => {
    if (!lockState.pinCodeEnabled || lockState.status === "locked") {
      return false;
    }

    setUnlockedPinCode(null);
    setLockState((current) =>
      current.pinCodeEnabled
        ? {
            pinCodeEnabled: true,
            revision: current.revision + 1,
            status: "locked",
          }
        : current,
    );
    return true;
  }, [
    lockState.pinCodeEnabled,
    lockState.status,
    setLockState,
    setUnlockedPinCode,
  ]);
}

function useSetPinCodeAction(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
  readonly unlockedPinCode: string | null;
}): (pinCode: string) => Promise<boolean> {
  return useCallback(
    async (pinCode: string): Promise<boolean> => {
      if (
        !input.environment.canManagePinCode ||
        !input.environment.manifestStore ||
        !input.environment.pinCodeConfigNamespace ||
        !pinCode
      ) {
        return false;
      }

      let protectedAnyManifest = false;
      try {
        protectedAnyManifest = await rewrapExistingManifestsWithPin({
          manifestStore: input.environment.manifestStore,
          pinCode,
          scopes: input.environment.scopes,
          sourcePinCode: input.unlockedPinCode,
        });
      } catch {
        return false;
      }
      if (!protectedAnyManifest) {
        input.environment.storage?.removeItem(
          pinCodeConfigKey(input.environment.pinCodeConfigNamespace),
        );
        return false;
      }

      input.environment.storage?.setItem(
        pinCodeConfigKey(input.environment.pinCodeConfigNamespace),
        "1",
      );
      input.setUnlockedPinCode(pinCode);
      input.setLockState((current) => ({
        pinCodeEnabled: true,
        revision: current.revision + 1,
        status: "unlocked",
      }));
      return true;
    },
    [input],
  );
}

function useClearPinCodeAction(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
}): (pinCode: string) => Promise<boolean> {
  return useCallback(
    async (pinCode: string): Promise<boolean> => {
      if (
        !input.environment.canManagePinCode ||
        !input.environment.manifestStore ||
        !input.environment.pinCodeConfigNamespace ||
        !pinCode
      ) {
        return false;
      }

      try {
        await rewrapExistingManifests({
          manifestStore: input.environment.manifestStore,
          scopes: input.environment.scopes,
          sourcePinCode: pinCode,
          targetKeystore: createPlainKeystore(),
        });
      } catch {
        return false;
      }

      input.environment.storage?.removeItem(
        pinCodeConfigKey(input.environment.pinCodeConfigNamespace),
      );
      input.setUnlockedPinCode(null);
      input.setLockState((current) => ({
        pinCodeEnabled: false,
        revision: current.revision + 1,
        status: "unlocked",
      }));
      return true;
    },
    [input],
  );
}

function useLocalKeyringLockContextValue(input: {
  readonly clearPinCode: (pinCode: string) => Promise<boolean>;
  readonly createLocalKeyring: () => LocalKeyring;
  readonly environment: LocalKeyringLockEnvironment;
  readonly lock: () => boolean;
  readonly lockState: LockState;
  readonly refresh: () => Promise<void>;
  readonly setPinCode: (pinCode: string) => Promise<boolean>;
  readonly unlock: (pinCode: string) => Promise<boolean>;
}): LocalKeyringLockContextValue {
  return useMemo(
    () => ({
      canManagePinCode: input.environment.canManagePinCode,
      clearPinCode: input.clearPinCode,
      createLocalKeyring:
        input.environment.canManagePinCode ||
        input.environment.hostCreateLocalKeyring
          ? input.createLocalKeyring
          : undefined,
      isLocked: input.lockState.status === "locked",
      lock: input.lock,
      pinCodeEnabled: input.lockState.pinCodeEnabled,
      refresh: input.refresh,
      revision: input.lockState.revision,
      setPinCode: input.setPinCode,
      status: input.lockState.status,
      unlock: input.unlock,
    }),
    [input],
  );
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
