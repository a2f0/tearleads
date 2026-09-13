import { expect, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { encryptLocalIdentityPayload } from "../identity/localIdentityPackageCrypto";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  clearPersistedCryptoSessionForIdentity,
  type LocalCryptoSessionPersistence,
  localCryptoSessionStorageKey,
  persistableCryptoSessionContext,
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
        rootAcknowledgments: [],
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
        rootAcknowledgments: [],
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
    rootAcknowledgments: [],
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
    rootAcknowledgments: [],
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
      rootAcknowledgments: [],
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
        rootAcknowledgments: [],
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
        rootAcknowledgments: [],
        organizationId: "stale-organization",
        userId: "stale-user",
      },
      localPersistence: { keyring, scope, storage, storageKey },
      signingFingerprint,
    }),
  ).toBe(false);

  expect(globalThis.localStorage.getItem(storageKey)).toBeNull();
});

test("server root acknowledgements survive encrypted session restore", async () => {
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
    rootAcknowledgments: [
      {
        signingFingerprint,
        userId: "user-root",
        organizationId: "org-root",
        rootContainerId: "server-root",
      },
    ],
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
  const restored = await restorePersistedCryptoSession({
    localPersistence,
    signingFingerprint,
  });
  expect(restored).toEqual(context);
  if (!restored) throw new Error("expected persisted session");
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
  });
  try {
    await sdk.identity.setKeyPairs({
      signingFingerprint,
      signingKeyPair: generateSigningSeedAndKeyPair(),
      encapsulationKeyPair: null,
    });
    sdk.session.setContext(restored);
    expect(sdk.session.containerId).toBe("container-root");
    expect(sdk.runtime.input().auth.rootContainerId).toBe("server-root");
    sdk.session.setContext({
      organizationId: "org-root",
      containerId: "forged-listed-root",
    });
    expect(sdk.runtime.input().auth.rootContainerId).toBe("server-root");
  } finally {
    sdk.dispose();
  }

  // Missing acknowledgements force a fresh login; never infer one from the view.
  const { rootAcknowledgments: _omitted, ...incompleteContext } = context;
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
          ...incompleteContext,
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
  ).toBeNull();
});

test("an unacknowledged user id is never persisted across an identity switch", async () => {
  const namespace = `session-switch-${crypto.randomUUID()}`;
  const signingFingerprint = "f".repeat(64);
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope(namespace);
  (await keyring.getOrCreateSession(scope)).dispose();
  const localPersistence: LocalCryptoSessionPersistence = {
    keyring,
    scope,
    storage: createMemoryStorage(),
    storageKey: localCryptoSessionStorageKey(namespace, signingFingerprint),
  };
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
  });
  try {
    await sdk.identity.setKeyPairs({
      signingFingerprint,
      signingKeyPair: generateSigningSeedAndKeyPair(),
      encapsulationKeyPair: null,
    });
    sdk.session.setContext({ organizationId: "org-switch" });
    // A locally chosen user id, as the identity switcher's persist-before-
    // transition path would see it.
    sdk.session.setUserId("local-choice");
    expect(sdk.session.userIdAcknowledged).toBe(false);
    expect(
      await persistCryptoSession({
        context: persistableCryptoSessionContext(
          sdk.session.snapshot,
          sdk.session.userIdAcknowledged,
        ),
        localPersistence,
        signingFingerprint,
      }),
    ).toBe(true);
    const restored = await restorePersistedCryptoSession({
      localPersistence,
      signingFingerprint,
    });
    expect(restored?.userId).toBeNull();
    expect(restored?.organizationId).toBe("org-switch");

    // A server-acknowledged user id survives the same round trip.
    sdk.session.setContext({ userId: "acknowledged-user" });
    expect(sdk.session.userIdAcknowledged).toBe(true);
    expect(
      await persistCryptoSession({
        context: persistableCryptoSessionContext(
          sdk.session.snapshot,
          sdk.session.userIdAcknowledged,
        ),
        localPersistence,
        signingFingerprint,
      }),
    ).toBe(true);
    const restoredAcknowledged = await restorePersistedCryptoSession({
      localPersistence,
      signingFingerprint,
    });
    expect(restoredAcknowledged?.userId).toBe("acknowledged-user");
  } finally {
    sdk.dispose();
  }
});
