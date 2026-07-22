import type {
  LocalKeyring,
  LocalKeyringManifestStore,
  LocalKeyringScope,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  createBrowserLocalKeyringForPinCode,
  createDynamicLocalKeyring,
  createPinKeystore,
  createPlainKeystore,
  hasPinWrappedManifest,
  type LocalKeyringLockEnvironment,
  type LocalKeyringLockStatus,
  type LockState,
  pinCodeConfigKey,
  rewrapExistingManifests,
  verifyPinCode,
} from "./localKeyringLockSupport";

export interface LocalKeyringLockContextValue {
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
  readonly canManagePinCode: boolean;
  readonly hostCreateLocalKeyring: (() => LocalKeyring) | undefined;
  readonly pinCodeEnabled: boolean;
  readonly unlockedPinCode: string | null;
}

interface DynamicKeyringPlan {
  /**
   * Stable identity of the keyring configuration the current state resolves to.
   * Equal signatures mean the same underlying keyring can be reused; a change
   * (lock/unlock, PIN rotation) mints a fresh one.
   */
  readonly signature: string;
  readonly create: () => LocalKeyring;
}

/**
 * Maps the current lock/PIN/host state to the keyring it should produce, plus a
 * signature identifying that configuration. Returns null when no keyring is
 * available (locked, or PIN management unsupported), which the dynamic keyring
 * surfaces as a locked keyring.
 */
function planDynamicLocalKeyring(
  state: DynamicKeyringState,
): DynamicKeyringPlan | null {
  if (state.hostCreateLocalKeyring) {
    const hostCreateLocalKeyring = state.hostCreateLocalKeyring;
    return { create: () => hostCreateLocalKeyring(), signature: "host" };
  }
  if (!state.canManagePinCode) {
    return null;
  }
  if (!state.pinCodeEnabled) {
    return {
      create: () => createBrowserLocalKeyringForPinCode(null),
      signature: "plain",
    };
  }
  if (!state.unlockedPinCode) {
    return null;
  }

  const pinCode = state.unlockedPinCode;
  return {
    create: () => createBrowserLocalKeyringForPinCode(pinCode),
    signature: `pin:${pinCode}`,
  };
}

export function useDynamicLocalKeyringFactory(input: {
  readonly environment: LocalKeyringLockEnvironment;
  readonly lockState: LockState;
  readonly unlockedPinCode: string | null;
}): () => LocalKeyring {
  const stateRef = useRef<DynamicKeyringState>({
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
  // Cache the resolved underlying keyring across calls. The dynamic keyring's
  // methods (getOrCreateSession/loadSession/deleteSession) each resolve the
  // underlying keyring, and every distinct keyring instance opens its own
  // IndexedDB connections (the wrapping-key + manifest stores) that are never
  // explicitly closed. Minting a fresh keyring per call therefore leaks a
  // growing set of open IndexedDB connections to the same databases — and on a
  // WKWebView (Capacitor/Electrobun) a subsequent `indexedDB.open()` of a
  // database that already has open connections can hang indefinitely (no
  // success/error/blocked event fires). That surfaced as the second local
  // identity's SQLite cipher-key resolution wedging forever ("Creating
  // identity..." never completing). Reusing one keyring per configuration keeps
  // a single connection set alive and reused; a new one is minted only when the
  // configuration signature changes (lock/unlock, PIN rotation).
  const cacheRef = useRef<{
    readonly keyring: LocalKeyring;
    readonly signature: string;
  } | null>(null);

  return useCallback((): LocalKeyring => {
    return createDynamicLocalKeyring(() => {
      const plan = planDynamicLocalKeyring(stateRef.current);
      if (!plan) {
        cacheRef.current = null;
        return null;
      }
      const cached = cacheRef.current;
      if (cached && cached.signature === plan.signature) {
        return cached.keyring;
      }
      const keyring = plan.create();
      cacheRef.current = { keyring, signature: plan.signature };
      return keyring;
    });
  }, []);
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
