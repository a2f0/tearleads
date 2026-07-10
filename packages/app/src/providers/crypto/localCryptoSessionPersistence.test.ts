import { expect, test } from "bun:test";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  clearPersistedCryptoSessionForIdentity,
  type LocalCryptoSessionPersistence,
  localCryptoSessionStorageKey,
  persistCryptoSession,
  queueCryptoSessionPersistence,
  restorePersistedCryptoSession,
} from "./localCryptoSessionPersistence";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

test("crypto sessions are persisted independently for each identity", async () => {
  const namespace = "session-test";
  const identityA = "a".repeat(64);
  const identityB = "b".repeat(64);
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope(namespace);
  (await keyring.getOrCreateSession(scope)).dispose();
  const storage = createMemoryStorage();
  const persistenceFor = (
    signingFingerprint: string,
  ): LocalCryptoSessionPersistence => ({
    keyring,
    scope,
    storage,
    storageKey: localCryptoSessionStorageKey(namespace, signingFingerprint),
  });

  await persistCryptoSession({
    context: {
      authToken: "token-a",
      containerId: "container-a",
      isAuthenticated: true,
      organizationId: "org-a",
      userId: "user-a",
    },
    localPersistence: persistenceFor(identityA),
    signingFingerprint: identityA,
  });
  await persistCryptoSession({
    context: {
      authToken: "token-b",
      containerId: "container-b",
      isAuthenticated: true,
      organizationId: "org-b",
      userId: "user-b",
    },
    localPersistence: persistenceFor(identityB),
    signingFingerprint: identityB,
  });

  expect(storage.values.size).toBe(2);
  expect(
    await restorePersistedCryptoSession({
      localPersistence: persistenceFor(identityA),
      signingFingerprint: identityA,
    }),
  ).toEqual({
    authToken: "token-a",
    containerId: "container-a",
    isAuthenticated: true,
    organizationId: "org-a",
    userId: "user-a",
  });
  expect(
    await restorePersistedCryptoSession({
      localPersistence: persistenceFor(identityB),
      signingFingerprint: identityB,
    }),
  ).toEqual({
    authToken: "token-b",
    containerId: "container-b",
    isAuthenticated: true,
    organizationId: "org-b",
    userId: "user-b",
  });
});

test("clearing an identity session wins over an older in-flight write", async () => {
  const namespace = `session-clear-${crypto.randomUUID()}`;
  const signingFingerprint = "a".repeat(64);
  const storageKey = localCryptoSessionStorageKey(
    namespace,
    signingFingerprint,
  );
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope(namespace);
  (await keyring.getOrCreateSession(scope)).dispose();
  let clearDuringWrite = true;
  const storage = {
    getItem: (key: string) => globalThis.localStorage.getItem(key),
    removeItem: (key: string) => globalThis.localStorage.removeItem(key),
    setItem: (key: string, value: string) => {
      globalThis.localStorage.setItem(key, value);
      if (clearDuringWrite) {
        clearDuringWrite = false;
        clearPersistedCryptoSessionForIdentity({
          namespace,
          signingFingerprint,
        });
      }
    },
  };

  await queueCryptoSessionPersistence({
    context: {
      authToken: "stale-token",
      containerId: "stale-container",
      isAuthenticated: true,
      organizationId: "stale-organization",
      userId: "stale-user",
    },
    localPersistence: { keyring, scope, storage, storageKey },
    signingFingerprint,
  });

  expect(globalThis.localStorage.getItem(storageKey)).toBeNull();
});
