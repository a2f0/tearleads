import type { LocalKeyring, Tearleads } from "@tearleads/client-sdk";
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
  "tearleads.local-identity-registry:";

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
  readonly tearleads: Tearleads;
}): Promise<void> {
  const observedGenerationId = input.generationIdRef.current;
  const stored = await input.localPersistence.load();
  if (input.isCancelled()) {
    return;
  }
  input.onIdentitiesChanged(stored.identities);
  if (!stored.activeKeyPackage || input.tearleads.identity.signingKeyPair) {
    return;
  }
  if (input.generationIdRef.current !== observedGenerationId) {
    return;
  }

  const generationId = observedGenerationId + 1;
  input.generationIdRef.current = generationId;
  input.generationInFlight.current = true;
  try {
    prepareForIdentityTransition(input.tearleads);
    const snapshot = await input.tearleads.identity.importKeyPackage(
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
    input.tearleads.log("Local identity key package restored");
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
  readonly tearleads: Tearleads;
}): void {
  const {
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    onRestored,
    onSettled,
    tearleads,
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
      tearleads,
    })
      .catch((error: unknown) => {
        tearleads.logError("Failed to restore local identity registry", error);
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
    tearleads,
  ]);
}

/** Restore the active identity once per repository source and expose its list. */
export function useLocalIdentityRestore(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityRepository | null;
  readonly tearleads: Tearleads;
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
  readonly tearleads: Tearleads;
}): Promise<void> {
  if (!input.localPersistence || input.shouldPersist?.() === false) {
    return;
  }

  const keyPackage = await input.tearleads.identity.exportKeyPackage();
  if (input.shouldPersist?.() === false) {
    return;
  }
  const identities = await input.localPersistence.upsert(keyPackage);
  if (input.shouldPersist?.() === false) {
    return;
  }
  input.onIdentitiesChanged(identities);
  input.tearleads.log("Local identity key package persisted");
}

export function usePersistLocalIdentity(
  localPersistence: LocalIdentityRepository | null,
  onIdentitiesChanged: (identities: readonly LocalIdentitySummary[]) => void,
  tearleads: Tearleads,
): (shouldPersist?: () => boolean) => Promise<void> {
  return useCallback(
    (shouldPersist?: () => boolean) =>
      persistLocalIdentityKeyPackage({
        localPersistence,
        onIdentitiesChanged,
        shouldPersist,
        tearleads,
      }),
    [localPersistence, onIdentitiesChanged, tearleads],
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
  readonly tearleads: Tearleads;
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
    tearleads,
  } = input;
  const [identityDestroyed, setIdentityDestroyed] = useState(false);

  const destroyKey = useCallback(() => {
    if (generationInFlight.current) {
      return;
    }
    const signingFingerprint = tearleads.identity.signingFingerprint;
    generationIdRef.current += 1;
    setIdentityDestroyed(true);
    prepareForIdentityTransition(tearleads);
    tearleads.identity.destroy();
    clearDatabase();

    if (!signingFingerprint) {
      return;
    }
    onIdentityRemoved?.(signingFingerprint);
    void localPersistence
      ?.remove(signingFingerprint)
      .then(onIdentitiesChanged)
      .catch((error: unknown) => {
        tearleads.logError(
          "Failed to delete local identity key package",
          error,
        );
      });
  }, [
    clearDatabase,
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    onIdentityRemoved,
    tearleads,
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
