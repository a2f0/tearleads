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

export function useDynamicLocalKeyringFactory(input: {
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

export function useUnlockAction(input: {
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

export function useClearPinCodeAction(input: {
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
