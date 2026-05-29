import { expect, test } from "bun:test";
import {
  createLocalKeyring,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  decodeLocalKeyringSqliteKey,
  type LocalKeyringManifest,
  type LocalKeyringManifestStore,
  type LocalKeyringScope,
  localKeyringScopeKey,
  parseLocalKeyringManifest,
  serializeLocalKeyringManifest,
} from "./localKeyring";

const scope: LocalKeyringScope = {
  accountId: "user-1",
  namespace: "tearleads-test",
  signingFingerprint: "signing-fingerprint-1",
};

test("local keyring creates and reloads stable scoped keys", async () => {
  const keystore = createMemoryWrappingKeyKeystore();
  const manifestStore = createMemoryLocalKeyringManifestStore();
  const keyring = createLocalKeyring({ keystore, manifestStore });

  const session = await keyring.getOrCreateSession(scope);
  const reopened = await createLocalKeyring({
    keystore,
    manifestStore,
  }).loadSession(scope);

  expect(reopened).not.toBeNull();
  if (!reopened) {
    throw new Error("Expected reopened local keyring session");
  }
  expect(decodeLocalKeyringSqliteKey(session.sqliteKey)).toHaveLength(32);
  expect(session.blobStoreKey).toHaveLength(32);
  expect(session.identityPersistenceKey).toHaveLength(32);
  expect(Array.from(session.blobStoreKey)).not.toEqual(
    Array.from(decodeLocalKeyringSqliteKey(session.sqliteKey)),
  );
  expect(reopened.sqliteKey).toBe(session.sqliteKey);
  expect(reopened.blobStoreKey).toEqual(session.blobStoreKey);
  expect(reopened.identityPersistenceKey).toEqual(
    session.identityPersistenceKey,
  );

  await expect(reopened.deriveKey("custom-purpose")).resolves.toEqual(
    await session.deriveKey("custom-purpose"),
  );
});

test("local keyring scopes manifests by namespace and identity", async () => {
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore: createMemoryLocalKeyringManifestStore(),
  });
  const session = await keyring.getOrCreateSession(scope);

  const anotherScope = { ...scope, signingFingerprint: "other-fingerprint" };

  expect(localKeyringScopeKey(scope)).not.toBe(
    localKeyringScopeKey(anotherScope),
  );
  await expect(keyring.loadSession(anotherScope)).resolves.toBeNull();

  const otherSession = await keyring.getOrCreateSession(anotherScope);
  expect(otherSession.sqliteKey).not.toBe(session.sqliteKey);
});

test("local keyring deduplicates concurrent session creation for one scope", async () => {
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore: createMemoryLocalKeyringManifestStore(),
  });

  const [firstSession, secondSession] = await Promise.all([
    keyring.getOrCreateSession(scope),
    keyring.getOrCreateSession(scope),
  ]);

  expect(secondSession).toBe(firstSession);
  expect(secondSession.sqliteKey).toBe(firstSession.sqliteKey);
  expect(secondSession.blobStoreKey).toEqual(firstSession.blobStoreKey);
});

test("local keyring reuses resolved sessions until they are deleted", async () => {
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore: createMemoryLocalKeyringManifestStore(),
  });

  const firstSession = await keyring.getOrCreateSession(scope);
  const secondSession = await keyring.getOrCreateSession(scope);
  expect(secondSession).toBe(firstSession);

  await keyring.deleteSession(scope);
  const recreatedSession = await keyring.getOrCreateSession(scope);

  expect(recreatedSession).not.toBe(firstSession);
  expect(recreatedSession.sqliteKey).not.toBe(firstSession.sqliteKey);
});

test("local keyring sessions can dispose sensitive in-memory buffers", async () => {
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore: createMemoryLocalKeyringManifestStore(),
  });
  const session = await keyring.getOrCreateSession(scope);
  const blobStoreKey = session.blobStoreKey.slice();
  const identityPersistenceKey = session.identityPersistenceKey.slice();

  session.dispose();

  expect(Array.from(session.blobStoreKey)).toEqual(
    new Array(session.blobStoreKey.byteLength).fill(0),
  );
  expect(Array.from(session.identityPersistenceKey)).toEqual(
    new Array(session.identityPersistenceKey.byteLength).fill(0),
  );
  await expect(session.deriveKey("custom-purpose")).rejects.toThrow("disposed");

  const reopenedSession = await keyring.getOrCreateSession(scope);
  expect(reopenedSession).not.toBe(session);
  expect(reopenedSession.blobStoreKey).toEqual(blobStoreKey);
  expect(reopenedSession.identityPersistenceKey).toEqual(
    identityPersistenceKey,
  );
});

test("local keyring manifest serializes and parses its wrapped root key", async () => {
  const manifestStore = createMemoryLocalKeyringManifestStore();
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore,
  });
  await keyring.getOrCreateSession(scope);
  const manifest = await manifestStore.loadManifest(scope);
  if (!manifest) {
    throw new Error("Expected local keyring manifest");
  }

  const parsed = parseLocalKeyringManifest(
    serializeLocalKeyringManifest(manifest),
  );

  expect(parsed).toEqual(manifest);
  expect(parsed.rootKeyEnvelope.ciphertext).not.toHaveLength(0);
  expect(parsed.rootKeyEnvelope.context.purpose).toBe("account-root");
});

test("local keyring refuses a manifest bound to the wrong secret context", async () => {
  const keystore = createMemoryWrappingKeyKeystore();
  const manifestStore = createMemoryLocalKeyringManifestStore();
  const keyring = createLocalKeyring({ keystore, manifestStore });
  await keyring.getOrCreateSession(scope);
  const manifest = await manifestStore.loadManifest(scope);
  if (!manifest) {
    throw new Error("Expected local keyring manifest");
  }
  const tamperedManifest: LocalKeyringManifest = {
    ...manifest,
    rootKeyEnvelope: {
      ...manifest.rootKeyEnvelope,
      context: {
        ...manifest.rootKeyEnvelope.context,
        purpose: "sqlite",
      },
    },
  };
  const tamperedStore: LocalKeyringManifestStore = {
    deleteManifest: async () => undefined,
    loadManifest: async () => tamperedManifest,
    saveManifest: async () => undefined,
  };

  await expect(
    createLocalKeyring({ keystore, manifestStore: tamperedStore }).loadSession(
      scope,
    ),
  ).rejects.toThrow("context");
});

test("local keyring requires the wrapping key provider to unwrap an existing manifest", async () => {
  const manifestStore = createMemoryLocalKeyringManifestStore();
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore,
  });
  await keyring.getOrCreateSession(scope);

  await expect(
    createLocalKeyring({
      keystore: createMemoryWrappingKeyKeystore(),
      manifestStore,
    }).loadSession(scope),
  ).rejects.toThrow("Wrapping key is unavailable");
});

test("local keyring deletes the manifest and wrapping key", async () => {
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore: createMemoryLocalKeyringManifestStore(),
  });
  await keyring.getOrCreateSession(scope);

  await keyring.deleteSession(scope);

  await expect(keyring.loadSession(scope)).resolves.toBeNull();
});
