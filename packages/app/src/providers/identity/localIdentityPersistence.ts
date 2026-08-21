import type { LocalKeyring, SymCrypt } from "@symcrypt/client-sdk";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getLocalStorage } from "../../utils/storedPreference";
import { createHostLocalKeyring } from "../local-keyring/localKeyringLockSupport";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";
import {
  LocalIdentityRepository,
  type LocalIdentitySummary,
} from "./localIdentityRegistry";

const LOCAL_IDENTITY_REGISTRY_STORAGE_PREFIX =
  "symcrypt.local-identity-registry:";

function localIdentityRegistryStorageKey(namespace: string): string {
  return `${LOCAL_IDENTITY_REGISTRY_STORAGE_PREFIX}${namespace}`;
}

export function useLocalIdentityPersistence(input: {
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly namespace: string | null;
}): LocalIdentityRepository | null {
  const localIdentityStorage = useMemo(
    () => (input.namespace ? getLocalStorage() : null),
    [input.namespace],
  );
  const localIdentityKeyring = useMemo(
    () =>
      input.namespace
        ? createHostLocalKeyring({
            createLocalKeyring: input.createLocalKeyring,
            storage: localIdentityStorage,
          })
        : null,
    [input.createLocalKeyring, input.namespace, localIdentityStorage],
  );

  return useMemo(() => {
    if (!input.namespace || !localIdentityKeyring || !localIdentityStorage) {
      return null;
    }

    return new LocalIdentityRepository({
      keyring: localIdentityKeyring,
      scope: localIdentityScope(input.namespace),
      storage: localIdentityStorage,
      storageKey: localIdentityRegistryStorageKey(input.namespace),
    });
  }, [input.namespace, localIdentityKeyring, localIdentityStorage]);
}

async function restorePersistedLocalIdentity(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly isCancelled: () => boolean;
  readonly localPersistence: LocalIdentityRepository;
  readonly onIdentitiesChanged: (
    identities: readonly LocalIdentitySummary[],
  ) => void;
  readonly onRestored: (signingFingerprint: string | null) => void;
  readonly symcrypt: SymCrypt;
}): Promise<void> {
  const observedGenerationId = input.generationIdRef.current;
  const stored = await input.localPersistence.load();
  if (input.isCancelled()) {
    return;
  }
  input.onIdentitiesChanged(stored.identities);
  if (!stored.activeKeyPackage || input.symcrypt.identity.signingKeyPair) {
    return;
  }
  if (input.generationIdRef.current !== observedGenerationId) {
    return;
  }

  const generationId = observedGenerationId + 1;
  input.generationIdRef.current = generationId;
  input.generationInFlight.current = true;
  try {
    prepareForIdentityTransition(input.symcrypt);
    const snapshot = await input.symcrypt.identity.importKeyPackage(
      stored.activeKeyPackage,
    );
    if (input.isCancelled() || input.generationIdRef.current !== generationId) {
      return;
    }
    if (snapshot.signingFingerprint !== stored.activeSigningFingerprint) {
      throw new Error(
        "Saved active identity fingerprint does not match its key package.",
      );
    }
    input.onRestored(snapshot.signingFingerprint);
    input.symcrypt.log("Local identity key package restored");
  } finally {
    if (input.generationIdRef.current === generationId) {
      input.generationInFlight.current = false;
    }
  }
}

function useRestoreLocalIdentity(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityRepository | null;
  readonly onIdentitiesChanged: (
    identities: readonly LocalIdentitySummary[],
  ) => void;
  readonly onRestored: (signingFingerprint: string | null) => void;
  readonly onSettled: (settledSource: LocalIdentityRepository | null) => void;
  readonly symcrypt: SymCrypt;
}): void {
  const {
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    onRestored,
    onSettled,
    symcrypt,
  } = input;
  const attemptedSourceRef = useRef<LocalIdentityRepository | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (attemptedSourceRef.current === localPersistence) {
      return;
    }
    attemptedSourceRef.current = localPersistence;

    if (!localPersistence) {
      onIdentitiesChanged([]);
      onSettled(localPersistence);
      return;
    }

    let cancelled = false;
    let settled = false;
    void restorePersistedLocalIdentity({
      generationIdRef,
      generationInFlight,
      isCancelled: () => cancelled,
      localPersistence,
      onIdentitiesChanged,
      onRestored,
      symcrypt,
    })
      .catch((error: unknown) => {
        symcrypt.logError("Failed to restore local identity registry", error);
      })
      .finally(() => {
        if (!cancelled) {
          settled = true;
          onSettled(localPersistence);
        }
      });

    return () => {
      cancelled = true;
      if (!settled && attemptedSourceRef.current === localPersistence) {
        attemptedSourceRef.current = undefined;
      }
    };
  }, [
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    onRestored,
    onSettled,
    symcrypt,
  ]);
}

/** Restore the active identity once per repository source and expose its list. */
export function useLocalIdentityRestore(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityRepository | null;
  readonly symcrypt: SymCrypt;
}): {
  readonly identities: readonly LocalIdentitySummary[];
  readonly restoredFingerprint: string | null;
  readonly restoreSettled: boolean;
  readonly setIdentities: (identities: readonly LocalIdentitySummary[]) => void;
} {
  const [identities, setIdentities] = useState<readonly LocalIdentitySummary[]>(
    [],
  );
  const [restoredFingerprint, setRestoredFingerprint] = useState<string | null>(
    null,
  );
  const [settledSource, setSettledSource] = useState<
    LocalIdentityRepository | null | undefined
  >(undefined);
  useRestoreLocalIdentity({
    ...input,
    onIdentitiesChanged: setIdentities,
    onRestored: setRestoredFingerprint,
    onSettled: setSettledSource,
  });

  return {
    identities,
    restoredFingerprint,
    restoreSettled: settledSource === input.localPersistence,
    setIdentities,
  };
}

async function persistLocalIdentityKeyPackage(input: {
  readonly localPersistence: LocalIdentityRepository | null;
  readonly onIdentitiesChanged: (
    identities: readonly LocalIdentitySummary[],
  ) => void;
  readonly shouldPersist?: (() => boolean) | undefined;
  readonly symcrypt: SymCrypt;
}): Promise<void> {
  if (!input.localPersistence || input.shouldPersist?.() === false) {
    return;
  }

  const keyPackage = await input.symcrypt.identity.exportKeyPackage();
  if (input.shouldPersist?.() === false) {
    return;
  }
  const identities = await input.localPersistence.upsert(keyPackage);
  if (input.shouldPersist?.() === false) {
    return;
  }
  input.onIdentitiesChanged(identities);
  input.symcrypt.log("Local identity key package persisted");
}

export function usePersistLocalIdentity(
  localPersistence: LocalIdentityRepository | null,
  onIdentitiesChanged: (identities: readonly LocalIdentitySummary[]) => void,
  symcrypt: SymCrypt,
): (shouldPersist?: () => boolean) => Promise<void> {
  return useCallback(
    (shouldPersist?: () => boolean) =>
      persistLocalIdentityKeyPackage({
        localPersistence,
        onIdentitiesChanged,
        shouldPersist,
        symcrypt,
      }),
    [localPersistence, onIdentitiesChanged, symcrypt],
  );
}

export function useDestroyKey(input: {
  readonly clearDatabase: () => void;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityRepository | null;
  readonly onIdentitiesChanged: (
    identities: readonly LocalIdentitySummary[],
  ) => void;
  readonly onIdentityRemoved?:
    | ((signingFingerprint: string) => void)
    | undefined;
  readonly symcrypt: SymCrypt;
}): {
  readonly destroyKey: () => void;
  readonly identityDestroyed: boolean;
} {
  const {
    clearDatabase,
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    onIdentityRemoved,
    symcrypt,
  } = input;
  const [identityDestroyed, setIdentityDestroyed] = useState(false);

  const destroyKey = useCallback(() => {
    if (generationInFlight.current) {
      return;
    }
    const signingFingerprint = symcrypt.identity.signingFingerprint;
    generationIdRef.current += 1;
    setIdentityDestroyed(true);
    prepareForIdentityTransition(symcrypt);
    symcrypt.identity.destroy();
    clearDatabase();

    if (!signingFingerprint) {
      return;
    }
    onIdentityRemoved?.(signingFingerprint);
    void localPersistence
      ?.remove(signingFingerprint)
      .then(onIdentitiesChanged)
      .catch((error: unknown) => {
        symcrypt.logError("Failed to delete local identity key package", error);
      });
  }, [
    clearDatabase,
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    onIdentityRemoved,
    symcrypt,
  ]);

  return { destroyKey, identityDestroyed };
}

export function useRestoreKeyPackage(input: {
  readonly importIdentityPackage: (keyPackage: unknown) => Promise<boolean>;
}): (keyPackage: unknown) => Promise<void> {
  return useCallback(
    async (keyPackage: unknown) => {
      if (!(await input.importIdentityPackage(keyPackage))) {
        throw new Error("Could not import the local identity key package.");
      }
    },
    [input.importIdentityPackage],
  );
}
