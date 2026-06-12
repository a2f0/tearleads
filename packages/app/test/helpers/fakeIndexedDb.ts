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

function createFakeIndexedDbObjectStore(
  records: Map<string, unknown>,
  transaction: FakeIndexedDbTransaction,
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
        records.set(keyId, value);
        return keyId;
      }, transaction),
    delete: (key: IDBValidKey) =>
      createFakeIndexedDbRequest(() => {
        records.delete(String(key));
        return undefined;
      }, transaction),
    get: (key: IDBValidKey) =>
      createFakeIndexedDbRequest(() => records.get(String(key)), transaction),
  } as unknown as IDBObjectStore;
}

function createFakeIndexedDbTransactionState(
  records: Map<string, unknown>,
): FakeIndexedDbTransaction {
  const transaction: FakeIndexedDbTransaction = {
    activeRequestCount: 0,
    completed: false,
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: () => createFakeIndexedDbObjectStore(records, transaction),
  };

  return transaction;
}

function createFakeIndexedDbTransaction(
  records: Map<string, unknown>,
): IDBTransaction {
  return createFakeIndexedDbTransactionState(
    records,
  ) as unknown as IDBTransaction;
}

function createFakeIndexedDbDatabase(
  stores: Map<string, Map<string, unknown>>,
): IDBDatabase {
  return {
    close: () => undefined,
    createObjectStore: (name: string) => {
      const records = new Map<string, unknown>();
      stores.set(name, records);
      return createFakeIndexedDbObjectStore(
        records,
        createFakeIndexedDbTransactionState(records),
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

      return createFakeIndexedDbTransaction(records);
    },
  } as unknown as IDBDatabase;
}

export function createFakeIndexedDb(): IDBFactory {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();

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
        request.result = createFakeIndexedDbDatabase(stores);
        if (needsUpgrade) {
          request.onupgradeneeded?.({} as IDBVersionChangeEvent);
        }
        request.onsuccess?.({} as Event);
      });

      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}
