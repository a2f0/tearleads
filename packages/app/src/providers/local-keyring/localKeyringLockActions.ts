import type {
  LocalKeyring,
  LocalKeyringManifestStore,
  LocalKeyringScope,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  createBrowserLocalKeyringForPinCode,
  createDynamicLocalKeyring,
  createPinKeystore,
  createPlainKeystore,
  hasPinWrappedManifest,
  type LocalKeyringFactory,
  type LocalKeyringLockEnvironment,
  type LocalKeyringLockStatus,
  type LockState,
  pinCodeConfigKey,
  rewrapExistingManifests,
  verifyPinCode,
} from "./localKeyringLockSupport";

export interface LocalKeyringLockContextValue {
  readonly canManagePinCode: boolean;
  readonly createLocalKeyring: LocalKeyringFactory | undefined;
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

interface DynamicKeyringState {
  readonly browserCreateLocalKeyring: (pinCode: string | null) => LocalKeyring;
  readonly canManagePinCode: boolean;
  readonly hostCreateLocalKeyring: (() => LocalKeyring) | undefined;
  readonly pinCodeEnabled: boolean;
  readonly revision: number;
  readonly unlockedPinCode: string | null;
}

type DynamicKeyringCapability = "host" | "pin" | "plain";

interface DynamicKeyringIdentity {
  readonly capability: DynamicKeyringCapability;
  readonly factory:
    | (() => LocalKeyring)
    | ((pinCode: string | null) => LocalKeyring);
  readonly revision: number;
}

interface DynamicKeyringPlan {
  readonly create: () => LocalKeyring;
  readonly identity: DynamicKeyringIdentity;
}

function sameDynamicKeyringIdentity(
  left: DynamicKeyringIdentity,
  right: DynamicKeyringIdentity,
): boolean {
  return (
    left.capability === right.capability &&
    left.factory === right.factory &&
    left.revision === right.revision
  );
}

/**
 * Maps the current lock/PIN/host state to the keyring it should produce, plus a
 * secret-free identity for that configuration. Returns null when no keyring is
 * available (locked, or PIN management unsupported), which the dynamic keyring
 * surfaces as a locked keyring.
 */
function planDynamicLocalKeyring(
  state: DynamicKeyringState,
): DynamicKeyringPlan | null {
  if (state.hostCreateLocalKeyring) {
    const hostCreateLocalKeyring = state.hostCreateLocalKeyring;
    return {
      create: () => hostCreateLocalKeyring(),
      identity: {
        capability: "host",
        factory: hostCreateLocalKeyring,
        revision: state.revision,
      },
    };
  }
  if (!state.canManagePinCode) {
    return null;
  }
  if (!state.pinCodeEnabled) {
    return {
      create: () => state.browserCreateLocalKeyring(null),
      identity: {
        capability: "plain",
        factory: state.browserCreateLocalKeyring,
        revision: state.revision,
      },
    };
  }
  if (!state.unlockedPinCode) {
    return null;
  }

  const pinCode = state.unlockedPinCode;
  return {
    create: () => state.browserCreateLocalKeyring(pinCode),
    identity: {
      capability: "pin",
      factory: state.browserCreateLocalKeyring,
      revision: state.revision,
    },
  };
}

export function useDynamicLocalKeyringFactory(input: {
  readonly createBrowserLocalKeyring?: (pinCode: string | null) => LocalKeyring;
  readonly environment: LocalKeyringLockEnvironment;
  readonly lockState: LockState;
  readonly unlockedPinCode: string | null;
}): LocalKeyringFactory {
  const stateRef = useRef<DynamicKeyringState>({
    browserCreateLocalKeyring:
      input.createBrowserLocalKeyring ?? createBrowserLocalKeyringForPinCode,
    canManagePinCode: input.environment.canManagePinCode,
    hostCreateLocalKeyring: input.environment.hostCreateLocalKeyring,
    pinCodeEnabled: input.lockState.pinCodeEnabled,
    revision: input.lockState.revision,
    unlockedPinCode: input.unlockedPinCode,
  });
  stateRef.current = {
    browserCreateLocalKeyring:
      input.createBrowserLocalKeyring ?? createBrowserLocalKeyringForPinCode,
    canManagePinCode: input.environment.canManagePinCode,
    hostCreateLocalKeyring: input.environment.hostCreateLocalKeyring,
    pinCodeEnabled: input.lockState.pinCodeEnabled,
    revision: input.lockState.revision,
    unlockedPinCode: input.unlockedPinCode,
  };
  // Cache the resolved underlying keyring across calls. The dynamic keyring's
  // methods (getOrCreateSession/loadSession/deleteSession) each resolve the
  // underlying keyring, and every distinct keyring instance opens its own
  // IndexedDB connections (the wrapping-key + manifest stores). Minting a fresh
  // keyring per call therefore churns connections to the same databases, and on
  // a WKWebView (Capacitor/Electrobun) a subsequent `indexedDB.open()` can hang
  // indefinitely (no success/error/blocked event fires). That surfaced as the
  // second local identity's SQLite cipher-key resolution wedging forever
  // ("Creating identity..." never completing). Reusing one keyring per
  // configuration keeps a single connection set alive and reused; a new one is
  // minted only when the configuration identity changes (lock/unlock, PIN
  // rotation).
  const cacheRef = useRef<{
    readonly identity: DynamicKeyringIdentity;
    readonly keyring: LocalKeyring;
  } | null>(null);
  const closeCachedKeyring = useCallback(() => {
    const cached = cacheRef.current;
    cacheRef.current = null;
    cached?.keyring.close?.();
  }, []);

  // Drop the cached keyring EAGERLY when the configuration changes, not only
  // lazily on the next keyring call. Otherwise locking (unlockedPinCode -> null)
  // while no keyring op runs would keep the PIN-bearing keyring cached, so
  // unlocking with the same PIN could otherwise reuse the stale keyring. The
  // revision distinguishes those configurations without retaining the PIN in a
  // cache key, while capability and factory identity cover environment changes.
  useEffect(() => {
    const identity = planDynamicLocalKeyring(stateRef.current)?.identity;
    if (
      cacheRef.current &&
      (!identity ||
        !sameDynamicKeyringIdentity(cacheRef.current.identity, identity))
    ) {
      closeCachedKeyring();
    }
  }, [
    closeCachedKeyring,
    input.createBrowserLocalKeyring,
    input.environment.canManagePinCode,
    input.environment.hostCreateLocalKeyring,
    input.lockState.pinCodeEnabled,
    input.lockState.revision,
    input.unlockedPinCode,
  ]);
  useEffect(() => closeCachedKeyring, [closeCachedKeyring]);

  return useMemo((): LocalKeyringFactory => {
    return Object.assign(
      (): LocalKeyring =>
        createDynamicLocalKeyring(() => {
          const plan = planDynamicLocalKeyring(stateRef.current);
          if (!plan) {
            closeCachedKeyring();
            return null;
          }
          const cached = cacheRef.current;
          if (
            cached &&
            sameDynamicKeyringIdentity(cached.identity, plan.identity)
          ) {
            return cached.keyring;
          }
          closeCachedKeyring();
          const keyring = plan.create();
          cacheRef.current = { identity: plan.identity, keyring };
          return keyring;
        }, closeCachedKeyring),
      {
        invalidateCachedKeyring: () => {
          closeCachedKeyring();
        },
      },
    );
  }, [closeCachedKeyring]);
}

export function useUnlockAction(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
}): (pinCode: string) => Promise<boolean> {
  const { environment, setLockState, setUnlockedPinCode } = input;
  return useCallback(
    async (pinCode: string): Promise<boolean> => {
      if (
        !environment.canManagePinCode ||
        !environment.manifestStore ||
        !environment.pinCodeConfigNamespace ||
        !pinCode
      ) {
        return false;
      }

      let verified = false;
      try {
        verified = await verifyPinCode({
          manifestStore: environment.manifestStore,
          pinCode,
          scopes: environment.scopes,
        });
      } catch {
        return false;
      }
      if (!verified) {
        return false;
      }

      setUnlockedPinCode(pinCode);
      setLockState((current) => ({
        pinCodeEnabled: true,
        revision: current.revision + 1,
        status: "unlocked",
      }));
      return true;
    },
    [environment, setLockState, setUnlockedPinCode],
  );
}

export function useLockAction(input: {
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

export function useSetPinCodeAction(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
  readonly unlockedPinCode: string | null;
}): (pinCode: string) => Promise<boolean> {
  const { environment, setLockState, setUnlockedPinCode, unlockedPinCode } =
    input;
  return useCallback(
    async (pinCode: string): Promise<boolean> => {
      if (
        !environment.canManagePinCode ||
        !environment.manifestStore ||
        !environment.pinCodeConfigNamespace ||
        !pinCode
      ) {
        return false;
      }

      let protectedAnyManifest = false;
      try {
        protectedAnyManifest = await rewrapExistingManifestsWithPin({
          manifestStore: environment.manifestStore,
          pinCode,
          scopes: environment.scopes,
          sourcePinCode: unlockedPinCode,
        });
      } catch {
        return false;
      }
      if (!protectedAnyManifest) {
        environment.storage?.removeItem(
          pinCodeConfigKey(environment.pinCodeConfigNamespace),
        );
        return false;
      }

      environment.storage?.setItem(
        pinCodeConfigKey(environment.pinCodeConfigNamespace),
        "1",
      );
      setUnlockedPinCode(pinCode);
      setLockState((current) => ({
        pinCodeEnabled: true,
        revision: current.revision + 1,
        status: "unlocked",
      }));
      return true;
    },
    [environment, setLockState, setUnlockedPinCode, unlockedPinCode],
  );
}

export function useClearPinCodeAction(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly setLockState: Dispatch<SetStateAction<LockState>>;
  readonly setUnlockedPinCode: Dispatch<SetStateAction<string | null>>;
}): (pinCode: string) => Promise<boolean> {
  const { environment, setLockState, setUnlockedPinCode } = input;
  return useCallback(
    async (pinCode: string): Promise<boolean> => {
      if (
        !environment.canManagePinCode ||
        !environment.manifestStore ||
        !environment.pinCodeConfigNamespace ||
        !pinCode
      ) {
        return false;
      }

      try {
        await rewrapExistingManifests({
          manifestStore: environment.manifestStore,
          scopes: environment.scopes,
          sourcePinCode: pinCode,
          targetKeystore: createPlainKeystore(),
        });
      } catch {
        return false;
      }

      environment.storage?.removeItem(
        pinCodeConfigKey(environment.pinCodeConfigNamespace),
      );
      setUnlockedPinCode(null);
      setLockState((current) => ({
        pinCodeEnabled: false,
        revision: current.revision + 1,
        status: "unlocked",
      }));
      return true;
    },
    [environment, setLockState, setUnlockedPinCode],
  );
}

export function useLocalKeyringLockContextValue(input: {
  readonly clearPinCode: (pinCode: string) => Promise<boolean>;
  readonly createLocalKeyring: () => LocalKeyring;
  readonly environment: LocalKeyringLockEnvironment;
  readonly lock: () => boolean;
  readonly lockState: LockState;
  readonly refresh: () => Promise<void>;
  readonly setPinCode: (pinCode: string) => Promise<boolean>;
  readonly unlock: (pinCode: string) => Promise<boolean>;
}): LocalKeyringLockContextValue {
  const {
    clearPinCode,
    createLocalKeyring,
    environment,
    lock,
    lockState,
    refresh,
    setPinCode,
    unlock,
  } = input;
  return useMemo(
    () => ({
      canManagePinCode: environment.canManagePinCode,
      clearPinCode,
      createLocalKeyring:
        environment.canManagePinCode || environment.hostCreateLocalKeyring
          ? createLocalKeyring
          : undefined,
      isLocked: lockState.status === "locked",
      lock,
      pinCodeEnabled: lockState.pinCodeEnabled,
      refresh,
      revision: lockState.revision,
      setPinCode,
      status: lockState.status,
      unlock,
    }),
    [
      environment.canManagePinCode,
      environment.hostCreateLocalKeyring,
      clearPinCode,
      createLocalKeyring,
      lock,
      refresh,
      setPinCode,
      unlock,
      lockState.pinCodeEnabled,
      lockState.revision,
      lockState.status,
    ],
  );
}
