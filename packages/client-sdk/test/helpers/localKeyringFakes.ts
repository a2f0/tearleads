import type { LocalKeyringManifestStorage } from "../../src/client/localKeyring";

export function createTestManifestStorage(): LocalKeyringManifestStorage {
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

interface FakeIndexedDbStore {
  readonly keyPath: string;
  readonly records: Map<string, unknown>;
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
  store: FakeIndexedDbStore,
  transaction: FakeIndexedDbTransaction,
  rejectCryptoKeyValues = false,
): IDBObjectStore {
  const { keyPath, records } = store;
  const writeRecord = (value: unknown, allowOverwrite: boolean): string => {
    const key = String((value as Record<string, unknown>)[keyPath]);
    if (!allowOverwrite && records.has(key)) {
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
    records.set(key, structuredClone(value));
    return key;
  };
  return {
    add: (value: unknown) =>
      createFakeIndexedDbRequest(() => writeRecord(value, false), transaction),
    put: (value: unknown) =>
      createFakeIndexedDbRequest(() => writeRecord(value, true), transaction),
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
  store: FakeIndexedDbStore,
  rejectCryptoKeyValues = false,
): IDBTransaction {
  const transaction: FakeIndexedDbTransaction = {
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: () =>
      createFakeIndexedDbObjectStore(store, transaction, rejectCryptoKeyValues),
  };

  return transaction as unknown as IDBTransaction;
}

function createFakeIndexedDbDatabase(
  databaseName: string,
  stores: Map<string, FakeIndexedDbStore>,
  rejectCryptoKeyValues = false,
  onClose?: (databaseName: string) => void,
): IDBDatabase {
  return {
    close: () => onClose?.(databaseName),
    createObjectStore: (name: string, options?: { keyPath?: string }) => {
      const store: FakeIndexedDbStore = {
        keyPath: options?.keyPath ?? "keyId",
        records: new Map<string, unknown>(),
      };
      stores.set(name, store);
      return createFakeIndexedDbObjectStore(
        store,
        createFakeIndexedDbTransaction(
          store,
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
      const store = storeName ? stores.get(storeName) : undefined;
      if (!store) {
        throw new Error("Fake IndexedDB object store does not exist.");
      }

      return createFakeIndexedDbTransaction(store, rejectCryptoKeyValues);
    },
  } as unknown as IDBDatabase;
}

interface FakeIndexedDbOptions {
  readonly failOpenCount?: number | undefined;
  /** Observes every database `close()`, keyed by database name. */
  readonly onClose?: ((databaseName: string) => void) | undefined;
  /**
   * Reject `add`s of records that carry a live CryptoKey, the way WKWebView
   * fails to structured-clone a non-extractable CryptoKey into IndexedDB.
   */
  readonly rejectCryptoKeyValues?: boolean | undefined;
}

export function createFakeIndexedDb(
  options: FakeIndexedDbOptions = {},
): IDBFactory {
  const databases = new Map<string, Map<string, FakeIndexedDbStore>>();
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
          name,
          stores,
          rejectCryptoKeyValues,
          options.onClose,
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
