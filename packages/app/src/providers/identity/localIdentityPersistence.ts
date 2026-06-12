import {
  createBrowserLocalKeyring,
  type LocalKeyring,
  type LocalKeyringScope,
  type Tearleads,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type SigningKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { type MutableRefObject, useCallback, useEffect, useMemo } from "react";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  decryptLocalIdentityKeyPackage,
  encryptLocalIdentityKeyPackage,
} from "./localIdentityPackageCrypto";

const LOCAL_IDENTITY_PACKAGE_STORAGE_PREFIX =
  "tearleads.local-identity-key-package:";

type LocalIdentityStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

interface LocalIdentityPersistence {
  readonly keyring: LocalKeyring;
  readonly scope: LocalKeyringScope;
  readonly storage: LocalIdentityStorage;
  readonly storageKey: string;
}

function getDefaultLocalIdentityStorage(): LocalIdentityStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function createHostLocalKeyring(input: {
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly localIdentityStorage: LocalIdentityStorage | null;
}): LocalKeyring | null {
  if (input.createLocalKeyring) {
    return input.createLocalKeyring();
  }
  if (
    typeof globalThis.indexedDB === "undefined" ||
    !input.localIdentityStorage
  ) {
    return null;
  }

  return createBrowserLocalKeyring();
}

function localIdentityStorageKey(namespace: string): string {
  return `${LOCAL_IDENTITY_PACKAGE_STORAGE_PREFIX}${namespace}`;
}

export function useLocalIdentityPersistence(input: {
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly namespace: string | null;
}): LocalIdentityPersistence | null {
  const localIdentityStorage = useMemo(
    () => (input.namespace ? getDefaultLocalIdentityStorage() : null),
    [input.namespace],
  );
  const localIdentityKeyring = useMemo(
    () =>
      input.namespace
        ? createHostLocalKeyring({
            createLocalKeyring: input.createLocalKeyring,
            localIdentityStorage,
          })
        : null,
    [input.createLocalKeyring, input.namespace, localIdentityStorage],
  );

  return useMemo(() => {
    if (!input.namespace || !localIdentityKeyring || !localIdentityStorage) {
      return null;
    }

    return {
      keyring: localIdentityKeyring,
      scope: localIdentityScope(input.namespace),
      storage: localIdentityStorage,
      storageKey: localIdentityStorageKey(input.namespace),
    };
  }, [input.namespace, localIdentityKeyring, localIdentityStorage]);
}

async function restorePersistedLocalIdentity(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly isCancelled: () => boolean;
  readonly localPersistence: LocalIdentityPersistence;
  readonly onRestored: (signingFingerprint: string | null) => void;
  readonly tearleads: Tearleads;
}): Promise<void> {
  const observedGenerationId = input.generationIdRef.current;
  const serializedEnvelope = input.localPersistence.storage.getItem(
    input.localPersistence.storageKey,
  );
  if (!serializedEnvelope || input.isCancelled()) {
    return;
  }

  const session = await input.localPersistence.keyring.loadSession(
    input.localPersistence.scope,
  );
  if (!session) {
    return;
  }

  try {
    if (
      input.isCancelled() ||
      input.generationIdRef.current !== observedGenerationId
    ) {
      return;
    }

    const generationId = observedGenerationId + 1;
    input.generationIdRef.current = generationId;
    input.generationInFlight.current = true;
    try {
      const keyPackage = await decryptLocalIdentityKeyPackage({
        identityPersistenceKey: session.identityPersistenceKey,
        serializedEnvelope,
      });
      if (
        input.isCancelled() ||
        input.generationIdRef.current !== generationId ||
        input.tearleads.identity.signingKeyPair
      ) {
        return;
      }

      const snapshot =
        await input.tearleads.identity.importKeyPackage(keyPackage);
      input.onRestored(snapshot.signingFingerprint);
      input.tearleads.log("Local identity key package restored");
    } finally {
      if (input.generationIdRef.current === generationId) {
        input.generationInFlight.current = false;
      }
    }
  } finally {
    session.dispose();
  }
}

export function useRestoreLocalIdentity(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityPersistence | null;
  readonly onRestored: (signingFingerprint: string | null) => void;
  readonly signingKeyPair: SigningKeyPair | null;
  readonly tearleads: Tearleads;
}): void {
  const {
    generationIdRef,
    generationInFlight,
    localPersistence,
    onRestored,
    signingKeyPair,
    tearleads,
  } = input;

  useEffect(() => {
    if (!localPersistence || signingKeyPair) {
      return;
    }

    let cancelled = false;
    void restorePersistedLocalIdentity({
      generationIdRef,
      generationInFlight,
      isCancelled: () => cancelled,
      localPersistence,
      onRestored,
      tearleads,
    }).catch((error: unknown) => {
      tearleads.logError("Failed to restore local identity key package", error);
    });

    return () => {
      cancelled = true;
    };
  }, [
    generationIdRef,
    generationInFlight,
    localPersistence,
    onRestored,
    signingKeyPair,
    tearleads,
  ]);
}

async function persistLocalIdentityKeyPackage(input: {
  readonly localPersistence: LocalIdentityPersistence | null;
  readonly shouldPersist?: (() => boolean) | undefined;
  readonly tearleads: Tearleads;
}): Promise<void> {
  if (!input.localPersistence) {
    return;
  }
  if (input.shouldPersist && !input.shouldPersist()) {
    return;
  }

  const session = await input.localPersistence.keyring.getOrCreateSession(
    input.localPersistence.scope,
  );
  try {
    const keyPackage = await input.tearleads.identity.exportKeyPackage();
    const serializedEnvelope = await encryptLocalIdentityKeyPackage({
      identityPersistenceKey: session.identityPersistenceKey,
      keyPackage,
    });
    if (input.shouldPersist && !input.shouldPersist()) {
      return;
    }

    input.localPersistence.storage.setItem(
      input.localPersistence.storageKey,
      serializedEnvelope,
    );
    input.tearleads.log("Local identity key package persisted");
  } finally {
    session.dispose();
  }
}

export function usePersistLocalIdentity(
  localPersistence: LocalIdentityPersistence | null,
  tearleads: Tearleads,
): (shouldPersist?: () => boolean) => Promise<void> {
  return useCallback(
    (shouldPersist?: () => boolean) =>
      persistLocalIdentityKeyPackage({
        localPersistence,
        shouldPersist,
        tearleads,
      }),
    [localPersistence, tearleads],
  );
}

async function deletePersistedLocalIdentity(
  localPersistence: LocalIdentityPersistence | null,
): Promise<void> {
  if (!localPersistence) {
    return;
  }

  localPersistence.storage.removeItem(localPersistence.storageKey);
  await localPersistence.keyring.deleteSession(localPersistence.scope);
}

export function useGenerateKey(input: {
  readonly ensureIdentityDatabaseReady: (
    signingFingerprint: string,
  ) => Promise<void>;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistLocalIdentity: (
    shouldPersist?: () => boolean,
  ) => Promise<void>;
  readonly tearleads: Tearleads;
}): () => void {
  const {
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  } = input;

  return useCallback(() => {
    if (generationInFlight.current) {
      return;
    }

    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    generationInFlight.current = true;
    void (async () => {
      const signingKeyPair = generateSigningSeedAndKeyPair();
      const encapsulationKeyPair = generateKemSeedAndKeyPair();
      const signingFingerprint = await toFingerprint(
        signingKeyPair.signingPublicKey,
      );
      await ensureIdentityDatabaseReady(signingFingerprint);
      if (generationIdRef.current !== generationId) {
        return;
      }

      await tearleads.identity.setKeyPairs({
        encapsulationKeyPair,
        signingKeyPair,
      });
      await tearleads.session.bootstrapLocalRootContainer();
      if (generationIdRef.current !== generationId) {
        return;
      }

      generationInFlight.current = false;
      void persistLocalIdentity(
        () => generationIdRef.current === generationId,
      ).catch((error: unknown) => {
        tearleads.logError(
          "Failed to persist local identity key package",
          error,
        );
      });
    })().catch((error: unknown) => {
      if (generationIdRef.current !== generationId) {
        return;
      }

      generationInFlight.current = false;
      if (tearleads.identity.signingKeyPair) {
        tearleads.identity.destroy();
      }
      tearleads.logError("Failed to generate identity keys", error);
    });
  }, [
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  ]);
}

export function useDestroyKey(input: {
  readonly clearDatabase: () => void;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityPersistence | null;
  readonly tearleads: Tearleads;
}): () => void {
  const {
    clearDatabase,
    generationIdRef,
    generationInFlight,
    localPersistence,
    tearleads,
  } = input;

  return useCallback(() => {
    generationIdRef.current += 1;
    generationInFlight.current = false;
    tearleads.identity.destroy();
    clearDatabase();
    void deletePersistedLocalIdentity(localPersistence).catch(
      (error: unknown) => {
        tearleads.logError(
          "Failed to delete local identity key package",
          error,
        );
      },
    );
  }, [
    clearDatabase,
    generationIdRef,
    generationInFlight,
    localPersistence,
    tearleads,
  ]);
}

export function useRestoreKeyPackage(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistLocalIdentity: (
    shouldPersist?: () => boolean,
  ) => Promise<void>;
  readonly tearleads: Tearleads;
}): (keyPackage: unknown) => Promise<void> {
  const {
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  } = input;

  return useCallback(
    async (keyPackage: unknown) => {
      generationIdRef.current += 1;
      generationInFlight.current = false;
      await tearleads.identity.importKeyPackage(keyPackage);
      try {
        await persistLocalIdentity();
      } catch (error: unknown) {
        tearleads.logError(
          "Failed to persist local identity key package after restore",
          error,
        );
      }
    },
    [generationIdRef, generationInFlight, persistLocalIdentity, tearleads],
  );
}
