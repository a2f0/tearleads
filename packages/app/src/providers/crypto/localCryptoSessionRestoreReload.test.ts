import { expect, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  discardCryptoSessionForReload,
  type LocalCryptoSessionPersistence,
  localCryptoSessionStorageKey,
  persistCryptoSession,
  queueCryptoSessionPersistence,
  restorePersistedCryptoSession,
  restoreReloadCryptoSessionContext,
} from "./localCryptoSessionPersistence";

// A backup restore reloads into a signed-out session that pins no root, but
// keeps the identity's root acknowledgements (#2365 finding 24).

async function persistedSessionFixture() {
  const namespace = `restore-reload-${crypto.randomUUID()}`;
  const signingFingerprint = "f".repeat(64);
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope(namespace);
  (await keyring.getOrCreateSession(scope)).dispose();
  const values = new Map<string, string>();
  const localPersistence: LocalCryptoSessionPersistence = {
    keyring,
    scope,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    storageKey: localCryptoSessionStorageKey(namespace, signingFingerprint),
  };
  const context = {
    authToken: "token-1",
    containerId: "pre-restore-root",
    defaultOrganizationId: "org-1",
    isAuthenticated: true,
    isRoot: false,
    organizationId: "org-1",
    rootAcknowledgments: [
      {
        signingFingerprint,
        userId: "user-1",
        organizationId: "org-1",
        rootContainerId: "server-root",
      },
    ],
    userId: "user-1",
  };
  expect(
    await persistCryptoSession({
      context,
      localPersistence,
      signingFingerprint,
    }),
  ).toBe(true);
  return { context, localPersistence, signingFingerprint, values };
}

test("a restore reload signs out and unpins the root but keeps acknowledgements", async () => {
  const { context, localPersistence, signingFingerprint } =
    await persistedSessionFixture();

  expect(
    await queueCryptoSessionPersistence({
      context: restoreReloadCryptoSessionContext(context),
      final: true,
      localPersistence,
      signingFingerprint,
    }),
  ).toBe(true);
  // Nothing queued after the final write replaces it before the reload.
  expect(
    await queueCryptoSessionPersistence({
      context,
      localPersistence,
      signingFingerprint,
    }),
  ).toBe(false);

  const restored = await restorePersistedCryptoSession({
    localPersistence,
    signingFingerprint,
  });
  expect(restored).toEqual({
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    isRoot: false,
    organizationId: null,
    rootAcknowledgments: context.rootAcknowledgments,
    userId: "user-1",
  });
  if (!restored) throw new Error("expected the restore-reload record");

  // The acknowledged root still governs the organization after the restore.
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
    sdk.session.setContext({
      organizationId: "org-1",
      containerId: "forged-listed-root",
    });
    expect(sdk.runtime.input().auth.rootContainerId).toBe("server-root");
  } finally {
    sdk.dispose();
  }
});

test("a failed rewrite drops the record rather than pin the old root", async () => {
  const { context, localPersistence, signingFingerprint, values } =
    await persistedSessionFixture();

  discardCryptoSessionForReload(localPersistence);

  expect(values.has(localPersistence.storageKey)).toBe(false);
  expect(
    await queueCryptoSessionPersistence({
      context,
      localPersistence,
      signingFingerprint,
    }),
  ).toBe(false);
  expect(values.has(localPersistence.storageKey)).toBe(false);
});
