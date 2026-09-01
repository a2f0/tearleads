import type { LocalKeyring, LocalKeyringScope } from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { useMemo } from "react";
import { getLocalStorage } from "../../utils/storedPreference";
import {
  decryptLocalIdentityPayload,
  encryptLocalIdentityPayload,
} from "../identity/localIdentityPackageCrypto";
import { createHostLocalKeyring } from "../local-keyring/localKeyringLockSupport";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";

const LOCAL_CRYPTO_SESSION_FORMAT = "tearleads.app.crypto-session";
const LOCAL_CRYPTO_SESSION_STORAGE_PREFIX = "tearleads.local-session:";

interface CryptoSessionWriteState {
  generation: number;
  tail: Promise<void>;
}

const cryptoSessionWrites = new Map<string, CryptoSessionWriteState>();

type LocalCryptoSessionStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export interface PersistedCryptoSessionContext {
  readonly authToken: string | null;
  readonly containerId: string | null;
  readonly defaultOrganizationId: string | null;
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

export function localCryptoSessionStorageKey(
  namespace: string,
  signingFingerprint: string,
): string {
  return `${LOCAL_CRYPTO_SESSION_STORAGE_PREFIX}${namespace}:${signingFingerprint}`;
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
  const defaultOrganizationId = readNullableString(
    value,
    "defaultOrganizationId",
  );
  const userId = readNullableString(value, "userId");
  if (
    authToken === undefined ||
    containerId === undefined ||
    defaultOrganizationId === undefined ||
    organizationId === undefined ||
    userId === undefined
  ) {
    return null;
  }
  // Every authenticated session carries its identity's default organization;
  // system/Contacts bootstrap keys on it, so restoring an authenticated
  // session without one would leave bootstrap waiting forever. Fail closed —
  // discarding the stored session just forces a fresh sign-in.
  if (isAuthenticated && defaultOrganizationId === null) {
    return null;
  }

  return {
    authToken,
    containerId,
    defaultOrganizationId,
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
  readonly signingFingerprint: string | null;
}): LocalCryptoSessionPersistence | null {
  const localStorage = useMemo(
    () =>
      input.namespace && input.signingFingerprint ? getLocalStorage() : null,
    [input.namespace, input.signingFingerprint],
  );
  const keyring = useMemo(
    () =>
      input.namespace && input.signingFingerprint
        ? createHostLocalKeyring({
            createLocalKeyring: input.createLocalKeyring,
            storage: localStorage,
          })
        : null,
    [
      input.createLocalKeyring,
      input.namespace,
      input.signingFingerprint,
      localStorage,
    ],
  );

  return useMemo(() => {
    if (
      !input.namespace ||
      !input.signingFingerprint ||
      !keyring ||
      !localStorage
    ) {
      return null;
    }

    return {
      keyring,
      scope: localIdentityScope(input.namespace),
      storage: localStorage,
      storageKey: localCryptoSessionStorageKey(
        input.namespace,
        input.signingFingerprint,
      ),
    };
  }, [input.namespace, input.signingFingerprint, keyring, localStorage]);
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
      defaultOrganizationId: persistedSession.defaultOrganizationId,
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
}): Promise<boolean> {
  const session = await input.localPersistence.keyring.loadSession(
    input.localPersistence.scope,
  );
  if (!session) {
    return false;
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
    return true;
  } finally {
    session.dispose();
  }
}

function cryptoSessionWriteState(storageKey: string): CryptoSessionWriteState {
  const existing = cryptoSessionWrites.get(storageKey);
  if (existing) {
    return existing;
  }
  const created = { generation: 0, tail: Promise.resolve() };
  cryptoSessionWrites.set(storageKey, created);
  return created;
}

/** Serialize writes so an identity transition can durably flush its session. */
export function queueCryptoSessionPersistence(
  input: Parameters<typeof persistCryptoSession>[0],
): Promise<boolean> {
  const state = cryptoSessionWriteState(input.localPersistence.storageKey);
  const generation = state.generation;
  const operation = state.tail.then(async () => {
    if (state.generation !== generation) {
      return false;
    }
    const persisted = await persistCryptoSession(input);
    if (state.generation !== generation) {
      input.localPersistence.storage.removeItem(
        input.localPersistence.storageKey,
      );
      return false;
    }
    return persisted;
  });
  state.tail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function clearPersistedCryptoSession(
  storage: LocalCryptoSessionStorage,
  storageKey: string,
): void {
  cryptoSessionWriteState(storageKey).generation += 1;
  storage.removeItem(storageKey);
}

export function clearPersistedCryptoSessionForIdentity(input: {
  readonly namespace: string | null;
  readonly signingFingerprint: string;
}): void {
  if (!input.namespace) {
    return;
  }
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  clearPersistedCryptoSession(
    storage,
    localCryptoSessionStorageKey(input.namespace, input.signingFingerprint),
  );
}
