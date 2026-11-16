import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { useMemo } from "react";
import {
  type LocalCryptoSessionPersistence,
  useLocalCryptoSessionPersistence,
} from "../providers/crypto/localCryptoSessionPersistence";
import { useAppHostConfig } from "../providers/host/AppHostConfigProvider";
import {
  decryptLocalIdentityPayload,
  encryptLocalIdentityPayload,
} from "../providers/identity/localIdentityPackageCrypto";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import {
  normalizeAccountName,
  type PersistedAccountNaming,
} from "./accountNamingMachine";

// An identity's naming, sealed like its persisted crypto session: encrypted
// under the local keyring and stored per identity, so a restart between the
// prompt and the first registration neither drops the answer nor skips the
// question. The record goes once the account exists.

const ACCOUNT_NAMING_FORMAT = "tearleads.app.account-naming";
const ACCOUNT_NAMING_STORAGE_PREFIX = "tearleads.account-naming:";

export type AccountNamingPersistence = LocalCryptoSessionPersistence;

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
            storageKey: `${ACCOUNT_NAMING_STORAGE_PREFIX}${namespace}:${signingFingerprint}`,
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
  const normalized =
    typeof name === "string" ? normalizeAccountName(name) : null;
  return status === "named" && normalized !== null
    ? { name: normalized, status }
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
): Promise<void> {
  // The identity's own record may not have created the keyring session yet.
  const session = await persistence.keyring.getOrCreateSession(
    persistence.scope,
  );
  try {
    persistence.storage.setItem(
      persistence.storageKey,
      await encryptLocalIdentityPayload({
        identityPersistenceKey: session.identityPersistenceKey,
        payload: {
          ...naming,
          format: ACCOUNT_NAMING_FORMAT,
          signingFingerprint,
          version: 1,
        },
      }),
    );
  } finally {
    session.dispose();
  }
}
