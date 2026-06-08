import {
  createBrowserLocalKeyring,
  type IdentityKeyPackage,
  type LocalKeyring,
  type LocalKeyringScope,
  type Tearleads,
} from "@tearleads/client-sdk";
import type { SigningKeyPair } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { type MutableRefObject, useCallback, useEffect, useMemo } from "react";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const LOCAL_IDENTITY_PACKAGE_FORMAT =
  "tearleads.app.local-identity-key-package";
const LOCAL_IDENTITY_PACKAGE_STORAGE_PREFIX =
  "tearleads.local-identity-key-package:";
const LOCAL_IDENTITY_SCOPE_PREFIX = "tearleads.local-identity:";
const AES_GCM_IV_BYTES = 12;

type LocalIdentityStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

interface LocalIdentityPersistence {
  readonly keyring: LocalKeyring;
  readonly scope: LocalKeyringScope;
  readonly storage: LocalIdentityStorage;
  readonly storageKey: string;
}

interface LocalIdentityEnvelope {
  readonly algorithm: "aes-256-gcm";
  readonly ciphertext: string;
  readonly format: typeof LOCAL_IDENTITY_PACKAGE_FORMAT;
  readonly iv: string;
  readonly storedAt: string;
  readonly version: 1;
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

function localIdentityScope(namespace: string): LocalKeyringScope {
  return {
    namespace: `${LOCAL_IDENTITY_SCOPE_PREFIX}${namespace}`,
  };
}

function importAesGcmKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    key.slice(),
    { name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function randomBytes(byteLength: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}

function decodeBase64Bytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(base64ToBytes(value));
}

function readStringProperty(
  value: object,
  property: string,
  label: string,
): string {
  const rawValue = Reflect.get(value, property);
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return rawValue;
}

function readLocalIdentityEnvelope(value: unknown): LocalIdentityEnvelope {
  const parsedValue: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  if (!isPlainObject(parsedValue)) {
    throw new Error("Local identity package envelope must be an object.");
  }
  const format = readStringProperty(parsedValue, "format", "format");
  if (format !== LOCAL_IDENTITY_PACKAGE_FORMAT) {
    throw new Error("Local identity package envelope format is unsupported.");
  }
  if (Reflect.get(parsedValue, "version") !== 1) {
    throw new Error("Local identity package envelope version is unsupported.");
  }
  const algorithm = readStringProperty(parsedValue, "algorithm", "algorithm");
  if (algorithm !== "aes-256-gcm") {
    throw new Error(
      "Local identity package envelope algorithm is unsupported.",
    );
  }

  return {
    algorithm,
    ciphertext: readStringProperty(parsedValue, "ciphertext", "ciphertext"),
    format,
    iv: readStringProperty(parsedValue, "iv", "iv"),
    storedAt: readStringProperty(parsedValue, "storedAt", "storedAt"),
    version: 1,
  };
}

async function encryptLocalIdentityKeyPackage(input: {
  readonly identityPersistenceKey: Uint8Array;
  readonly keyPackage: IdentityKeyPackage;
}): Promise<string> {
  const key = await importAesGcmKey(input.identityPersistenceKey);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { iv, name: "AES-GCM" },
      key,
      TEXT_ENCODER.encode(JSON.stringify(input.keyPackage)),
    ),
  );
  const envelope: LocalIdentityEnvelope = {
    algorithm: "aes-256-gcm",
    ciphertext: bytesToBase64(ciphertext),
    format: LOCAL_IDENTITY_PACKAGE_FORMAT,
    iv: bytesToBase64(iv),
    storedAt: new Date().toISOString(),
    version: 1,
  };

  return JSON.stringify(envelope);
}

async function decryptLocalIdentityKeyPackage(input: {
  readonly identityPersistenceKey: Uint8Array;
  readonly serializedEnvelope: string;
}): Promise<unknown> {
  const envelope = readLocalIdentityEnvelope(input.serializedEnvelope);
  const key = await importAesGcmKey(input.identityPersistenceKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      iv: decodeBase64Bytes(envelope.iv),
      name: "AES-GCM",
    },
    key,
    decodeBase64Bytes(envelope.ciphertext),
  );

  return JSON.parse(TEXT_DECODER.decode(plaintext));
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
  readonly tearleads: Tearleads;
}): Promise<void> {
  const observedGenerationId = input.generationIdRef.current;
  const session = await input.localPersistence.keyring.loadSession(
    input.localPersistence.scope,
  );
  if (!session) {
    return;
  }

  try {
    const serializedEnvelope = input.localPersistence.storage.getItem(
      input.localPersistence.storageKey,
    );
    if (
      !serializedEnvelope ||
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

      await input.tearleads.identity.importKeyPackage(keyPackage);
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
  readonly signingKeyPair: SigningKeyPair | null;
  readonly tearleads: Tearleads;
}): void {
  const {
    generationIdRef,
    generationInFlight,
    localPersistence,
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
    signingKeyPair,
    tearleads,
  ]);
}

async function persistLocalIdentityKeyPackage(input: {
  readonly localPersistence: LocalIdentityPersistence | null;
  readonly tearleads: Tearleads;
}): Promise<void> {
  if (!input.localPersistence) {
    return;
  }

  const session = await input.localPersistence.keyring.getOrCreateSession(
    input.localPersistence.scope,
  );
  try {
    input.localPersistence.storage.setItem(
      input.localPersistence.storageKey,
      await encryptLocalIdentityKeyPackage({
        identityPersistenceKey: session.identityPersistenceKey,
        keyPackage: await input.tearleads.identity.exportKeyPackage(),
      }),
    );
    input.tearleads.log("Local identity key package persisted");
  } finally {
    session.dispose();
  }
}

export function usePersistLocalIdentity(
  localPersistence: LocalIdentityPersistence | null,
  tearleads: Tearleads,
): () => Promise<void> {
  return useCallback(
    () => persistLocalIdentityKeyPackage({ localPersistence, tearleads }),
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
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistLocalIdentity: () => Promise<void>;
  readonly tearleads: Tearleads;
}): () => void {
  const {
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
    void tearleads.identity
      .generate()
      .then(async () => {
        if (generationIdRef.current !== generationId) {
          return;
        }

        try {
          await persistLocalIdentity();
        } catch (error: unknown) {
          tearleads.logError(
            "Failed to persist local identity key package",
            error,
          );
        } finally {
          if (generationIdRef.current === generationId) {
            generationInFlight.current = false;
          }
        }
      })
      .catch((error: unknown) => {
        if (generationIdRef.current !== generationId) {
          return;
        }

        generationInFlight.current = false;
        tearleads.logError("Failed to generate identity keys", error);
      });
  }, [generationIdRef, generationInFlight, persistLocalIdentity, tearleads]);
}

export function useDestroyKey(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityPersistence | null;
  readonly tearleads: Tearleads;
}): () => void {
  const { generationIdRef, generationInFlight, localPersistence, tearleads } =
    input;

  return useCallback(() => {
    generationIdRef.current += 1;
    generationInFlight.current = false;
    tearleads.identity.destroy();
    void deletePersistedLocalIdentity(localPersistence).catch(
      (error: unknown) => {
        tearleads.logError(
          "Failed to delete local identity key package",
          error,
        );
      },
    );
  }, [generationIdRef, generationInFlight, localPersistence, tearleads]);
}

export function useRestoreKeyPackage(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistLocalIdentity: () => Promise<void>;
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
