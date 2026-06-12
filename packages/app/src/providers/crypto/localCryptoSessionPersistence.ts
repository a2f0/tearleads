import {
  createBrowserLocalKeyring,
  type LocalKeyring,
  type LocalKeyringScope,
} from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { useMemo } from "react";
import {
  decryptLocalIdentityPayload,
  encryptLocalIdentityPayload,
} from "../identity/localIdentityPackageCrypto";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";

const LOCAL_CRYPTO_SESSION_FORMAT = "tearleads.app.crypto-session";
const LOCAL_CRYPTO_SESSION_STORAGE_PREFIX = "tearleads.local-session:";

type LocalCryptoSessionStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

interface PersistedCryptoSessionContext {
  readonly authToken: string | null;
  readonly containerId: string | null;
  readonly isAuthenticated: boolean;
  readonly organizationId: string | null;
  readonly userId: string | null;
}

interface PersistedCryptoSessionEnvelope extends PersistedCryptoSessionContext {
  readonly format: typeof LOCAL_CRYPTO_SESSION_FORMAT;
  readonly signingFingerprint: string;
  readonly storedAt: string;
  readonly version: 1;
}

export interface LocalCryptoSessionPersistence {
  readonly keyring: LocalKeyring;
  readonly scope: LocalKeyringScope;
  readonly storage: LocalCryptoSessionStorage;
  readonly storageKey: string;
}

function getDefaultLocalCryptoSessionStorage(): LocalCryptoSessionStorage | null {
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
  readonly localStorage: LocalCryptoSessionStorage | null;
}): LocalKeyring | null {
  if (input.createLocalKeyring) {
    return input.createLocalKeyring();
  }
  if (typeof globalThis.indexedDB === "undefined" || !input.localStorage) {
    return null;
  }

  return createBrowserLocalKeyring();
}

function localCryptoSessionStorageKey(namespace: string): string {
  return `${LOCAL_CRYPTO_SESSION_STORAGE_PREFIX}${namespace}`;
}

function readNullableString(
  value: object,
  property: string,
): string | null | undefined {
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" || propertyValue === null
    ? propertyValue
    : undefined;
}

function parsePersistedCryptoSession(
  value: unknown,
): PersistedCryptoSessionEnvelope | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const isAuthenticated = Reflect.get(value, "isAuthenticated");
  const signingFingerprint = Reflect.get(value, "signingFingerprint");
  const storedAt = Reflect.get(value, "storedAt");
  if (
    Reflect.get(value, "format") !== LOCAL_CRYPTO_SESSION_FORMAT ||
    Reflect.get(value, "version") !== 1 ||
    typeof signingFingerprint !== "string" ||
    typeof storedAt !== "string" ||
    typeof isAuthenticated !== "boolean"
  ) {
    return null;
  }

  const authToken = readNullableString(value, "authToken");
  const containerId = readNullableString(value, "containerId");
  const organizationId = readNullableString(value, "organizationId");
  const userId = readNullableString(value, "userId");
  if (
    authToken === undefined ||
    containerId === undefined ||
    organizationId === undefined ||
    userId === undefined
  ) {
    return null;
  }

  return {
    authToken,
    containerId,
    format: LOCAL_CRYPTO_SESSION_FORMAT,
    isAuthenticated,
    organizationId,
    signingFingerprint,
    storedAt,
    userId,
    version: 1,
  };
}

export function useLocalCryptoSessionPersistence(input: {
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly namespace: string | null;
}): LocalCryptoSessionPersistence | null {
  const localStorage = useMemo(
    () => (input.namespace ? getDefaultLocalCryptoSessionStorage() : null),
    [input.namespace],
  );
  const keyring = useMemo(
    () =>
      input.namespace
        ? createHostLocalKeyring({
            createLocalKeyring: input.createLocalKeyring,
            localStorage,
          })
        : null,
    [input.createLocalKeyring, input.namespace, localStorage],
  );

  return useMemo(() => {
    if (!input.namespace || !keyring || !localStorage) {
      return null;
    }

    return {
      keyring,
      scope: localIdentityScope(input.namespace),
      storage: localStorage,
      storageKey: localCryptoSessionStorageKey(input.namespace),
    };
  }, [input.namespace, keyring, localStorage]);
}

export async function restorePersistedCryptoSession(input: {
  readonly localPersistence: LocalCryptoSessionPersistence;
  readonly signingFingerprint: string;
}): Promise<PersistedCryptoSessionContext | null> {
  const serializedEnvelope = input.localPersistence.storage.getItem(
    input.localPersistence.storageKey,
  );
  if (!serializedEnvelope) {
    return null;
  }

  const session = await input.localPersistence.keyring.loadSession(
    input.localPersistence.scope,
  );
  if (!session) {
    return null;
  }

  try {
    let payload: unknown;
    try {
      payload = await decryptLocalIdentityPayload({
        identityPersistenceKey: session.identityPersistenceKey,
        serializedEnvelope,
      });
    } catch {
      input.localPersistence.storage.removeItem(
        input.localPersistence.storageKey,
      );
      return null;
    }

    const persistedSession = parsePersistedCryptoSession(payload);
    if (
      !persistedSession ||
      persistedSession.signingFingerprint !== input.signingFingerprint
    ) {
      input.localPersistence.storage.removeItem(
        input.localPersistence.storageKey,
      );
      return null;
    }

    return {
      authToken: persistedSession.authToken,
      containerId: persistedSession.containerId,
      isAuthenticated:
        persistedSession.isAuthenticated && persistedSession.authToken !== null,
      organizationId: persistedSession.organizationId,
      userId: persistedSession.userId,
    };
  } finally {
    session.dispose();
  }
}

export async function persistCryptoSession(input: {
  readonly context: PersistedCryptoSessionContext;
  readonly localPersistence: LocalCryptoSessionPersistence;
  readonly signingFingerprint: string;
}): Promise<void> {
  const session = await input.localPersistence.keyring.loadSession(
    input.localPersistence.scope,
  );
  if (!session) {
    return;
  }

  try {
    const serializedEnvelope = await encryptLocalIdentityPayload({
      identityPersistenceKey: session.identityPersistenceKey,
      payload: {
        ...input.context,
        format: LOCAL_CRYPTO_SESSION_FORMAT,
        signingFingerprint: input.signingFingerprint,
        storedAt: new Date().toISOString(),
        version: 1,
      } satisfies PersistedCryptoSessionEnvelope,
    });
    input.localPersistence.storage.setItem(
      input.localPersistence.storageKey,
      serializedEnvelope,
    );
  } finally {
    session.dispose();
  }
}

export function clearPersistedCryptoSession(
  localPersistence: LocalCryptoSessionPersistence,
): void {
  localPersistence.storage.removeItem(localPersistence.storageKey);
}
