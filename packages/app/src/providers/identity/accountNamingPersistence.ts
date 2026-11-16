import type { LocalKeyring } from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { useMemo } from "react";
import { getLocalStorage } from "../../utils/storedPreference";
import {
  type LocalCryptoSessionPersistence,
  useLocalCryptoSessionPersistence,
} from "../crypto/localCryptoSessionPersistence";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLocalKeyringLock } from "../local-keyring/LocalKeyringLockProvider";
import { createHostLocalKeyring } from "../local-keyring/localKeyringLockSupport";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  decryptLocalIdentityPayload,
  encryptLocalIdentityPayload,
} from "./localIdentityPackageCrypto";

// An identity's account naming, sealed like its persisted crypto session:
// encrypted under the local keyring and stored per identity, so a restart
// between the first-launch prompt and a saved name neither drops the answer
// nor skips the question. Removed once the name is saved, or with the
// identity.

const ACCOUNT_NAMING_FORMAT = "tearleads.app.account-naming";
const ACCOUNT_NAMING_STORAGE_PREFIX = "tearleads.account-naming:";

/** The part of an identity's naming that outlives the page. */
export type PersistedAccountNaming =
  | { readonly status: "awaiting" }
  | { readonly name: string; readonly status: "named" };

export type AccountNamingPersistence = LocalCryptoSessionPersistence;

// Bumped by every removal. A seal carries the count from when it was queued,
// so one queued or still encrypting when its identity is removed never writes
// the record back.
const removals = new Map<string, number>();

/** The removal count a seal queued now must still see when it writes. */
export function accountNamingRemoval(
  persistence: AccountNamingPersistence,
): number {
  return removals.get(persistence.storageKey) ?? 0;
}

function accountNamingStorageKey(
  namespace: string,
  signingFingerprint: string,
): string {
  return `${ACCOUNT_NAMING_STORAGE_PREFIX}${namespace}:${signingFingerprint}`;
}

/** Null while the keyring is locked or the host keeps no local identities. */
export function useAccountNamingPersistence(
  signingFingerprint: string | null,
): AccountNamingPersistence | null {
  const { localIdentityNamespace } = useAppHostConfig();
  const { createLocalKeyring, isLocked } = useLocalKeyringLock();
  const namespace = isLocked ? null : (localIdentityNamespace ?? null);
  const sessionPersistence = useLocalCryptoSessionPersistence({
    createLocalKeyring,
    namespace,
    signingFingerprint,
  });

  return useMemo(
    () =>
      sessionPersistence && namespace && signingFingerprint
        ? {
            ...sessionPersistence,
            storageKey: accountNamingStorageKey(namespace, signingFingerprint),
          }
        : null,
    [namespace, sessionPersistence, signingFingerprint],
  );
}

function readPersistedAccountNaming(
  payload: unknown,
  signingFingerprint: string,
): PersistedAccountNaming | null {
  if (
    !isPlainObject(payload) ||
    Reflect.get(payload, "format") !== ACCOUNT_NAMING_FORMAT ||
    Reflect.get(payload, "version") !== 1 ||
    Reflect.get(payload, "signingFingerprint") !== signingFingerprint
  ) {
    return null;
  }
  const status = Reflect.get(payload, "status");
  if (status === "awaiting") {
    return { status };
  }
  const name = Reflect.get(payload, "name");
  return status === "named" && typeof name === "string" && name.trim()
    ? { name, status }
    : null;
}

/** The identity's sealed naming, or null; an unreadable record is dropped. */
export async function loadPersistedAccountNaming(
  persistence: AccountNamingPersistence,
  signingFingerprint: string,
): Promise<PersistedAccountNaming | null> {
  const serializedEnvelope = persistence.storage.getItem(
    persistence.storageKey,
  );
  if (!serializedEnvelope) {
    return null;
  }
  const session = await persistence.keyring.loadSession(persistence.scope);
  if (!session) {
    return null;
  }
  try {
    const naming = readPersistedAccountNaming(
      await decryptLocalIdentityPayload({
        identityPersistenceKey: session.identityPersistenceKey,
        serializedEnvelope,
      }).catch(() => null),
      signingFingerprint,
    );
    if (!naming) {
      persistence.storage.removeItem(persistence.storageKey);
    }
    return naming;
  } finally {
    session.dispose();
  }
}

export async function savePersistedAccountNaming(
  persistence: AccountNamingPersistence,
  signingFingerprint: string,
  naming: PersistedAccountNaming,
  removal = accountNamingRemoval(persistence),
): Promise<void> {
  // The identity's own record may not have created the keyring session yet.
  const session = await persistence.keyring.getOrCreateSession(
    persistence.scope,
  );
  try {
    const serializedEnvelope = await encryptLocalIdentityPayload({
      identityPersistenceKey: session.identityPersistenceKey,
      payload: {
        ...naming,
        format: ACCOUNT_NAMING_FORMAT,
        signingFingerprint,
        version: 1,
      },
    });
    if (accountNamingRemoval(persistence) === removal) {
      persistence.storage.setItem(persistence.storageKey, serializedEnvelope);
    }
  } finally {
    session.dispose();
  }
}

/**
 * Seals a new identity's pending prompt before the identity itself is stored,
 * so a restart in between still asks for the name. The keyring is the host's
 * shared one, so it stays open, as the persisted crypto session leaves it.
 */
export async function sealPendingAccountNaming(input: {
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly namespace: string | null;
  readonly signingFingerprint: string;
}): Promise<void> {
  const storage = input.namespace ? getLocalStorage() : null;
  const keyring = storage
    ? createHostLocalKeyring({
        createLocalKeyring: input.createLocalKeyring,
        storage,
      })
    : null;
  if (!input.namespace || !storage || !keyring) {
    return;
  }
  await savePersistedAccountNaming(
    {
      keyring,
      scope: localIdentityScope(input.namespace),
      storage,
      storageKey: accountNamingStorageKey(
        input.namespace,
        input.signingFingerprint,
      ),
    },
    input.signingFingerprint,
    { status: "awaiting" },
  );
}

function removeAccountNaming(
  storage: Pick<Storage, "removeItem">,
  storageKey: string,
): void {
  removals.set(storageKey, (removals.get(storageKey) ?? 0) + 1);
  storage.removeItem(storageKey);
}

export function removePersistedAccountNaming(
  persistence: AccountNamingPersistence,
): void {
  removeAccountNaming(persistence.storage, persistence.storageKey);
}

/** Drops a removed identity's naming, and any seal of it still in flight. */
export function clearPersistedAccountNamingForIdentity(input: {
  readonly namespace: string | null;
  readonly signingFingerprint: string;
}): void {
  const storage = input.namespace ? getLocalStorage() : null;
  if (input.namespace && storage) {
    removeAccountNaming(
      storage,
      accountNamingStorageKey(input.namespace, input.signingFingerprint),
    );
  }
}
