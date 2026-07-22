interface FakeIndexedDbStore {
  readonly keyPath: string;
  readonly records: Map<string, unknown>;
}

interface FakeIndexedDbTransaction {
  activeRequestCount: number;
  completed: boolean;
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

function finishFakeIndexedDbRequest(
  transaction: FakeIndexedDbTransaction | null,
): void {
  if (!transaction) {
    return;
  }

  transaction.activeRequestCount -= 1;
  if (transaction.completed || transaction.activeRequestCount !== 0) {
    return;
  }

  transaction.completed = true;
  if (transaction.error) {
    transaction.onabort?.({} as Event);
  } else {
    transaction.oncomplete?.({} as Event);
  }
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

  if (transaction) {
    transaction.activeRequestCount += 1;
  }

  queueMicrotask(() => {
    try {
      request.result = operation();
      request.onsuccess?.({} as Event);
    } catch (error) {
      request.error =
        error instanceof Error ? error : new Error("IndexedDB request failed.");
      if (transaction) {
        transaction.error = request.error;
      }
      request.onerror?.({} as Event);
    } finally {
      finishFakeIndexedDbRequest(transaction);
    }
  });

  return request as unknown as IDBRequest<T>;
}

function recordKey(store: FakeIndexedDbStore, value: unknown): string {
  return String((value as Record<string, unknown>)[store.keyPath]);
}

function createFakeIndexedDbObjectStore(
  store: FakeIndexedDbStore,
  transaction: FakeIndexedDbTransaction,
): IDBObjectStore {
  return {
    add: (value: unknown) =>
      createFakeIndexedDbRequest(() => {
        const key = recordKey(store, value);
        if (store.records.has(key)) {
          throw createFakeIndexedDbError(
            "ConstraintError",
            "IndexedDB record already exists.",
          );
        }
        store.records.set(key, value);
        return key;
      }, transaction),
    put: (value: unknown) =>
      createFakeIndexedDbRequest(() => {
        const key = recordKey(store, value);
        store.records.set(key, value);
        return key;
      }, transaction),
    delete: (key: IDBValidKey) =>
      createFakeIndexedDbRequest(() => {
        store.records.delete(String(key));
        return undefined;
      }, transaction),
    get: (key: IDBValidKey) =>
      createFakeIndexedDbRequest(
        () => store.records.get(String(key)),
        transaction,
      ),
  } as unknown as IDBObjectStore;
}

function createFakeIndexedDbTransactionState(
  store: FakeIndexedDbStore,
): FakeIndexedDbTransaction {
  const transaction: FakeIndexedDbTransaction = {
    activeRequestCount: 0,
    completed: false,
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: () => createFakeIndexedDbObjectStore(store, transaction),
  };

  return transaction;
}

function createFakeIndexedDbTransaction(
  store: FakeIndexedDbStore,
): IDBTransaction {
  return createFakeIndexedDbTransactionState(
    store,
  ) as unknown as IDBTransaction;
}

/**
 * Counts databases handed out by `open` and given back by `close`, so a test can
 * assert a code path releases its connections. A real WKWebView can hang on a
 * later `indexedDB.open()` when earlier connections were leaked, which this fake
 * cannot reproduce; counting is the observable stand-in.
 */
interface FakeIndexedDbConnectionCounter {
  open: number;
}

function createFakeIndexedDbDatabase(
  stores: Map<string, FakeIndexedDbStore>,
  counter?: FakeIndexedDbConnectionCounter,
): IDBDatabase {
  let closed = false;
  if (counter) {
    counter.open += 1;
  }

  return {
    close: () => {
      // Real IDBDatabase.close() is idempotent; double-counting a repeated
      // close would mask a leak elsewhere.
      if (closed || !counter) {
        return;
      }
      closed = true;
      counter.open -= 1;
    },
    createObjectStore: (name: string, options?: { keyPath?: string }) => {
      const store: FakeIndexedDbStore = {
        keyPath: options?.keyPath ?? "keyId",
        records: new Map<string, unknown>(),
      };
      stores.set(name, store);
      return createFakeIndexedDbObjectStore(
        store,
        createFakeIndexedDbTransactionState(store),
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

      return createFakeIndexedDbTransaction(store);
    },
  } as unknown as IDBDatabase;
}

export function createFakeIndexedDb(
  counter?: FakeIndexedDbConnectionCounter,
): IDBFactory {
  const databases = new Map<string, Map<string, FakeIndexedDbStore>>();

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
        let stores = databases.get(name);
        const needsUpgrade = !stores;
        if (!stores) {
          stores = new Map();
          databases.set(name, stores);
        }
        request.result = createFakeIndexedDbDatabase(stores, counter);
        if (needsUpgrade) {
          request.onupgradeneeded?.({} as IDBVersionChangeEvent);
        }
        request.onsuccess?.({} as Event);
      });

      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

/**
 * A fake IndexedDB plus a live count of connections opened but not yet closed.
 */
export function createTrackedFakeIndexedDb(): {
  readonly indexedDB: IDBFactory;
  readonly openConnectionCount: () => number;
} {
  const counter: FakeIndexedDbConnectionCounter = { open: 0 };
  return {
    indexedDB: createFakeIndexedDb(counter),
    openConnectionCount: () => counter.open,
  };
}
