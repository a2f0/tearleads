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

// Every write to a record (a seal or a removal) claims the record's next
// generation when it is queued, and lands only while its claim is the latest.
// Claims are shared by every runtime on the page, so a seal still queued or
// encrypting in a runtime that has since unmounted never lands over what a
// later one wrote, and a removed identity's seal in flight never writes the
// record back.
const claims = new Map<string, number>();

function claimRecord(storageKey: string): number {
  const claim = (claims.get(storageKey) ?? 0) + 1;
  claims.set(storageKey, claim);
  return claim;
}

function isLatestClaim(storageKey: string, claim: number): boolean {
  return claims.get(storageKey) === claim;
}

/** Claims the record for a write queued now; see the claims above. */
export function claimAccountNamingWrite(
  persistence: AccountNamingPersistence,
): number {
  return claimRecord(persistence.storageKey);
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

/**
 * The identity's sealed naming, or null when it has none. A record that is
 * there but cannot be read as this identity's throws: it was sealed for a
 * name still owed, so the caller must not take it as no record at all.
 */
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
    throw new Error("The account name's keyring session is unavailable.");
  }
  try {
    const naming = readPersistedAccountNaming(
      await decryptLocalIdentityPayload({
        identityPersistenceKey: session.identityPersistenceKey,
        serializedEnvelope,
      }),
      signingFingerprint,
    );
    if (!naming) {
      throw new Error("The sealed account name is unreadable.");
    }
    return naming;
  } finally {
    session.dispose();
  }
}

/** Seals `naming`; false when a later claim on the record superseded it. */
export async function savePersistedAccountNaming(
  persistence: AccountNamingPersistence,
  signingFingerprint: string,
  naming: PersistedAccountNaming,
  claim = claimAccountNamingWrite(persistence),
): Promise<boolean> {
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
    if (!isLatestClaim(persistence.storageKey, claim)) {
      return false;
    }
    persistence.storage.setItem(persistence.storageKey, serializedEnvelope);
    return true;
  } finally {
    session.dispose();
  }
}

/**
 * Seals a new identity's name before the identity itself is stored,
 * so its first registration can resume after a restart. The keyring is the host's
 * shared one, so it stays open, as the persisted crypto session leaves it.
 */
export async function sealNewAccountName(input: {
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly name: string;
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
  const written = await savePersistedAccountNaming(
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
    { name: input.name, status: "named" },
  );
  if (!written) throw new Error("Account name storage was superseded.");
}

/** Removes the record; false when a later claim on it superseded this. */
export function removePersistedAccountNaming(
  persistence: AccountNamingPersistence,
  claim = claimAccountNamingWrite(persistence),
): boolean {
  if (!isLatestClaim(persistence.storageKey, claim)) {
    return false;
  }
  persistence.storage.removeItem(persistence.storageKey);
  return true;
}

/** Drops a removed identity's naming, and any seal of it still in flight. */
export function clearPersistedAccountNamingForIdentity(input: {
  readonly namespace: string | null;
  readonly signingFingerprint: string;
}): void {
  const storage = input.namespace ? getLocalStorage() : null;
  if (input.namespace && storage) {
    const storageKey = accountNamingStorageKey(
      input.namespace,
      input.signingFingerprint,
    );
    claimRecord(storageKey);
    storage.removeItem(storageKey);
  }
}
