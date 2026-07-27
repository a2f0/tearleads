import { expect, test } from "bun:test";
import {
  createBrowserLocalKeyring,
  createLocalKeyring,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  createWebViewLocalKeyring,
  decodeLocalKeyringSqliteKey,
  type LocalKeyringManifest,
  type LocalKeyringManifestStorage,
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

function createTestManifestStorage(): LocalKeyringManifestStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

interface FakeIndexedDbTransaction {
  error: Error | null;
  onabort: ((event: Event) => void) | null;
  oncomplete: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  objectStore(name: string): IDBObjectStore;
}

function createFakeIndexedDbError(name: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "name", { value: name });
  return error;
}

function createFakeIndexedDbRequest<T>(
  operation: () => T,
  transaction: FakeIndexedDbTransaction | null,
): IDBRequest<T> {
  const request = {
    error: null as Error | null,
    onerror: null as ((event: Event) => void) | null,
    onsuccess: null as ((event: Event) => void) | null,
    result: undefined as T,
  };

  queueMicrotask(() => {
    try {
      request.result = operation();
      request.onsuccess?.({} as Event);
      transaction?.oncomplete?.({} as Event);
    } catch (error) {
      request.error =
        error instanceof Error ? error : new Error("IndexedDB request failed.");
      if (transaction) {
        transaction.error = request.error;
      }
      request.onerror?.({} as Event);
      transaction?.onabort?.({} as Event);
    }
  });

  return request as unknown as IDBRequest<T>;
}

function recordContainsCryptoKey(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof CryptoKey !== "undefined" &&
    (value as { readonly key?: unknown }).key instanceof CryptoKey
  );
}

function createFakeIndexedDbObjectStore(
  records: Map<string, unknown>,
  transaction: FakeIndexedDbTransaction,
  rejectCryptoKeyValues = false,
): IDBObjectStore {
  return {
    add: (value: unknown) =>
      createFakeIndexedDbRequest(() => {
        const keyId = String((value as { readonly keyId: unknown }).keyId);
        if (records.has(keyId)) {
          throw createFakeIndexedDbError(
            "ConstraintError",
            "IndexedDB record already exists.",
          );
        }
        // Mirror WKWebView, which cannot structured-clone a CryptoKey into
        // IndexedDB without keychain access (errSecInteractionNotAllowed).
        if (rejectCryptoKeyValues && recordContainsCryptoKey(value)) {
          throw createFakeIndexedDbError(
            "DataCloneError",
            "The object can not be cloned.",
          );
        }
        // Real IndexedDB serializes the value on write, so the store is
        // independent of the caller's buffers (which the keyring may wipe).
        records.set(keyId, structuredClone(value));
        return keyId;
      }, transaction),
    delete: (key: IDBValidKey) =>
      createFakeIndexedDbRequest(() => {
        records.delete(String(key));
        return undefined;
      }, transaction),
    get: (key: IDBValidKey) =>
      createFakeIndexedDbRequest(() => {
        const stored = records.get(String(key));
        // Return an independent copy, as IndexedDB does for each read.
        return stored === undefined ? undefined : structuredClone(stored);
      }, transaction),
  } as unknown as IDBObjectStore;
}

function createFakeIndexedDbTransaction(
  records: Map<string, unknown>,
  rejectCryptoKeyValues = false,
): IDBTransaction {
  const transaction: FakeIndexedDbTransaction = {
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: () =>
      createFakeIndexedDbObjectStore(
        records,
        transaction,
        rejectCryptoKeyValues,
      ),
  };

  return transaction as unknown as IDBTransaction;
}

function createFakeIndexedDbDatabase(
  stores: Map<string, Map<string, unknown>>,
  rejectCryptoKeyValues = false,
): IDBDatabase {
  return {
    close: () => undefined,
    createObjectStore: (name: string) => {
      const records = new Map<string, unknown>();
      stores.set(name, records);
      return createFakeIndexedDbObjectStore(
        records,
        createFakeIndexedDbTransaction(
          records,
          rejectCryptoKeyValues,
        ) as unknown as FakeIndexedDbTransaction,
        rejectCryptoKeyValues,
      );
    },
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    onversionchange: null,
    transaction: (name: string | Iterable<string>) => {
      const storeName = typeof name === "string" ? name : Array.from(name)[0];
      const records = storeName ? stores.get(storeName) : undefined;
      if (!records) {
        throw new Error("Fake IndexedDB object store does not exist.");
      }

      return createFakeIndexedDbTransaction(records, rejectCryptoKeyValues);
    },
  } as unknown as IDBDatabase;
}

interface FakeIndexedDbOptions {
  readonly failOpenCount?: number | undefined;
  /**
   * Reject `add`s of records that carry a live CryptoKey, the way WKWebView
   * fails to structured-clone a non-extractable CryptoKey into IndexedDB.
   */
  readonly rejectCryptoKeyValues?: boolean | undefined;
}

function createFakeIndexedDb(options: FakeIndexedDbOptions = {}): IDBFactory {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();
  let remainingOpenFailures = options.failOpenCount ?? 0;
  const rejectCryptoKeyValues = options.rejectCryptoKeyValues ?? false;

  return {
    open: (name: string) => {
      const request = {
        error: null as Error | null,
        onerror: null as ((event: Event) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onupgradeneeded: null as
          | ((event: IDBVersionChangeEvent) => void)
          | null,
        result: undefined as IDBDatabase | undefined,
      };

      queueMicrotask(() => {
        if (remainingOpenFailures > 0) {
          remainingOpenFailures -= 1;
          request.error = createFakeIndexedDbError(
            "UnknownError",
            "Fake IndexedDB open failed.",
          );
          request.onerror?.({} as Event);
          return;
        }

        let stores = databases.get(name);
        const needsUpgrade = !stores;
        if (!stores) {
          stores = new Map();
          databases.set(name, stores);
        }
        request.result = createFakeIndexedDbDatabase(
          stores,
          rejectCryptoKeyValues,
        );
        if (needsUpgrade) {
          request.onupgradeneeded?.({} as IDBVersionChangeEvent);
        }
        request.onsuccess?.({} as Event);
      });

      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

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

test("browser local keyring persists manifests and non-extractable wrapping keys", async () => {
  const indexedDB = createFakeIndexedDb();
  const manifestStorage = createTestManifestStorage();
  const keyring = createBrowserLocalKeyring({ indexedDB, manifestStorage });
  const session = await keyring.getOrCreateSession(scope);

  expect(session.manifest.rootKeyEnvelope.provider).toBe("browser-indexeddb");
  expect(session.manifest.rootKeyEnvelope.keyId.startsWith("indexeddb:")).toBe(
    true,
  );

  const reopened = await createBrowserLocalKeyring({
    indexedDB,
    manifestStorage,
  }).loadSession(scope);

  expect(reopened).not.toBeNull();
  if (!reopened) {
    throw new Error("Expected reopened browser local keyring session");
  }
  expect(reopened.sqliteKey).toBe(session.sqliteKey);
  expect(reopened.blobStoreKey).toEqual(session.blobStoreKey);
  expect(reopened.identityPersistenceKey).toEqual(
    session.identityPersistenceKey,
  );
});

test("default browser local keyring fails when IndexedDB cannot clone a CryptoKey", async () => {
  // WKWebView (e.g. an unsigned Electrobun dev app) cannot structured-clone a
  // non-extractable CryptoKey into IndexedDB without keychain access.
  const indexedDB = createFakeIndexedDb({ rejectCryptoKeyValues: true });
  const manifestStorage = createTestManifestStorage();
  const keyring = createBrowserLocalKeyring({ indexedDB, manifestStorage });

  await expect(keyring.getOrCreateSession(scope)).rejects.toThrow(
    "can not be cloned",
  );
});

test("WebView local keyring persists raw key bytes and reloads without CryptoKey cloning", async () => {
  const indexedDB = createFakeIndexedDb({ rejectCryptoKeyValues: true });
  const manifestStorage = createTestManifestStorage();
  const keyring = createWebViewLocalKeyring({ indexedDB, manifestStorage });

  // Round-trips through the same IndexedDB that rejects CryptoKey values, so the
  // wrapping key must be persisted as raw bytes rather than a CryptoKey object.
  const session = await keyring.getOrCreateSession(scope);
  expect(decodeLocalKeyringSqliteKey(session.sqliteKey)).toHaveLength(32);

  const reopened = await createWebViewLocalKeyring({
    indexedDB,
    manifestStorage,
  }).loadSession(scope);

  expect(reopened).not.toBeNull();
  if (!reopened) {
    throw new Error("Expected reopened WebView local keyring session");
  }
  expect(reopened.sqliteKey).toBe(session.sqliteKey);
  expect(reopened.blobStoreKey).toEqual(session.blobStoreKey);
  expect(reopened.identityPersistenceKey).toEqual(
    session.identityPersistenceKey,
  );
});

test("WebView local keyring rejects browser CryptoKey records", async () => {
  const indexedDB = createFakeIndexedDb();
  const manifestStorage = createTestManifestStorage();

  await createBrowserLocalKeyring({
    indexedDB,
    manifestStorage,
  }).getOrCreateSession(scope);

  await expect(
    createWebViewLocalKeyring({ indexedDB, manifestStorage }).loadSession(
      scope,
    ),
  ).rejects.toThrow(
    "IndexedDB wrapping key record is missing its raw key material",
  );
});

test("browser local keyring retries IndexedDB open after a transient failure", async () => {
  const indexedDB = createFakeIndexedDb({ failOpenCount: 1 });
  const manifestStorage = createTestManifestStorage();
  const keyring = createBrowserLocalKeyring({ indexedDB, manifestStorage });

  await expect(keyring.getOrCreateSession(scope)).rejects.toThrow(
    "IndexedDB open failed",
  );
  await expect(keyring.getOrCreateSession(scope)).resolves.toMatchObject({
    scope,
  });
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
