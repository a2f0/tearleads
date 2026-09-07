import { expect, test } from "bun:test";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { encryptLocalIdentityPayload } from "../identity/localIdentityPackageCrypto";
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

  expect(
    await persistCryptoSession({
      context: {
        authToken: "token-a",
        containerId: "container-a",
        defaultOrganizationId: "default-org-a",
        isAuthenticated: true,
        isRoot: false,
        organizationId: "org-a",
        userId: "user-a",
      },
      localPersistence: persistenceFor(identityA),
      signingFingerprint: identityA,
    }),
  ).toBe(true);
  expect(
    await persistCryptoSession({
      context: {
        authToken: "token-b",
        containerId: "container-b",
        defaultOrganizationId: "default-org-b",
        isAuthenticated: true,
        isRoot: false,
        organizationId: "org-b",
        userId: "user-b",
      },
      localPersistence: persistenceFor(identityB),
      signingFingerprint: identityB,
    }),
  ).toBe(true);

  expect(storage.values.size).toBe(2);
  expect(
    await restorePersistedCryptoSession({
      localPersistence: persistenceFor(identityA),
      signingFingerprint: identityA,
    }),
  ).toEqual({
    authToken: "token-a",
    containerId: "container-a",
    defaultOrganizationId: "default-org-a",
    isAuthenticated: true,
    isRoot: false,
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
    defaultOrganizationId: "default-org-b",
    isAuthenticated: true,
    isRoot: false,
    organizationId: "org-b",
    userId: "user-b",
  });
});

test("an authenticated session without a default org fails closed", async () => {
  const namespace = `session-no-default-${crypto.randomUUID()}`;
  const signingFingerprint = "c".repeat(64);
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope(namespace);
  (await keyring.getOrCreateSession(scope)).dispose();
  const storage = createMemoryStorage();
  const localPersistence: LocalCryptoSessionPersistence = {
    keyring,
    scope,
    storage,
    storageKey: localCryptoSessionStorageKey(namespace, signingFingerprint),
  };

  // Every authenticated session carries its identity's default organization;
  // bootstrap keys on it, so a stored session missing one must be discarded
  // (forcing a fresh sign-in) instead of restoring into a forever-waiting
  // bootstrap.
  await persistCryptoSession({
    context: {
      authToken: "token",
      containerId: "container",
      defaultOrganizationId: null,
      isAuthenticated: true,
      isRoot: false,
      organizationId: "active-org",
      userId: "user",
    },
    localPersistence,
    signingFingerprint,
  });

  expect(
    await restorePersistedCryptoSession({
      localPersistence,
      signingFingerprint,
    }),
  ).toBeNull();
});

test("a session write reports unavailable key material", async () => {
  const namespace = `session-unavailable-${crypto.randomUUID()}`;
  const signingFingerprint = "d".repeat(64);
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const storage = createMemoryStorage();

  expect(
    await queueCryptoSessionPersistence({
      context: {
        authToken: "token",
        containerId: "container",
        defaultOrganizationId: "default-organization",
        isAuthenticated: true,
        isRoot: false,
        organizationId: "organization",
        userId: "user",
      },
      localPersistence: {
        keyring,
        scope: localIdentityScope(namespace),
        storage,
        storageKey: localCryptoSessionStorageKey(namespace, signingFingerprint),
      },
      signingFingerprint,
    }),
  ).toBe(false);
  expect(storage.values.size).toBe(0);
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

  expect(
    await queueCryptoSessionPersistence({
      context: {
        authToken: "stale-token",
        containerId: "stale-container",
        defaultOrganizationId: "stale-default-organization",
        isAuthenticated: true,
        isRoot: false,
        organizationId: "stale-organization",
        userId: "stale-user",
      },
      localPersistence: { keyring, scope, storage, storageKey },
      signingFingerprint,
    }),
  ).toBe(false);

  expect(globalThis.localStorage.getItem(storageKey)).toBeNull();
});

test("the root flag round-trips and a pre-root envelope restores as non-root", async () => {
  const namespace = `session-root-${crypto.randomUUID()}`;
  const signingFingerprint = "e".repeat(64);
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope(namespace);
  (await keyring.getOrCreateSession(scope)).dispose();
  const storage = createMemoryStorage();
  const storageKey = localCryptoSessionStorageKey(
    namespace,
    signingFingerprint,
  );
  const localPersistence: LocalCryptoSessionPersistence = {
    keyring,
    scope,
    storage,
    storageKey,
  };
  const context = {
    authToken: "token-root",
    containerId: "container-root",
    defaultOrganizationId: "default-org-root",
    isAuthenticated: true,
    isRoot: true,
    organizationId: "org-root",
    userId: "user-root",
  };

  expect(
    await persistCryptoSession({
      context,
      localPersistence,
      signingFingerprint,
    }),
  ).toBe(true);
  expect(
    await restorePersistedCryptoSession({
      localPersistence,
      signingFingerprint,
    }),
  ).toEqual(context);

  // Envelopes written before the flag existed carry no `isRoot`. They must
  // still restore, as non-root, so an upgrade does not sign everyone out.
  const { isRoot: _omitted, ...legacyContext } = context;
  const keyringSession = await keyring.loadSession(scope);
  if (!keyringSession) {
    throw new Error("expected keyring session");
  }
  try {
    storage.setItem(
      storageKey,
      await encryptLocalIdentityPayload({
        identityPersistenceKey: keyringSession.identityPersistenceKey,
        payload: {
          ...legacyContext,
          format: "tearleads.app.crypto-session",
          signingFingerprint,
          storedAt: new Date().toISOString(),
          version: 1,
        },
      }),
    );
  } finally {
    keyringSession.dispose();
  }
  expect(
    await restorePersistedCryptoSession({
      localPersistence,
      signingFingerprint,
    }),
  ).toEqual({ ...legacyContext, isRoot: false });
});
