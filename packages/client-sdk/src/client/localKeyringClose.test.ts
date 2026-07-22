import { expect, test } from "bun:test";
import { createBrowserLocalKeyring } from "./localKeyring";

interface FakeObjectStore {
  readonly data: Map<IDBValidKey, unknown>;
  readonly keyPath: string;
}

function createFakeIndexedDb(
  onClose: (databaseName: string) => void,
): IDBFactory {
  const databases = new Map<string, Map<string, FakeObjectStore>>();

  function request<T>(
    transaction: IDBTransaction,
    operation: () => T,
  ): IDBRequest<T> {
    const value = {
      error: null as Error | null,
      onerror: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      result: undefined as T,
    };
    queueMicrotask(() => {
      try {
        value.result = operation();
        value.onsuccess?.();
        transaction.oncomplete?.({} as Event);
      } catch (error) {
        value.error =
          error instanceof Error
            ? error
            : new Error("IndexedDB request failed.");
        value.onerror?.();
        transaction.onabort?.({} as Event);
      }
    });
    return value as unknown as IDBRequest<T>;
  }

  function createTransaction(store: FakeObjectStore): IDBTransaction {
    const transaction = {
      error: null,
      onabort: null,
      oncomplete: null,
      onerror: null,
      objectStore: () => ({
        add: (value: Record<string, unknown>) =>
          request(transaction as unknown as IDBTransaction, () => {
            const key = value[store.keyPath] as IDBValidKey;
            store.data.set(key, value);
            return key;
          }),
        get: (key: IDBValidKey) =>
          request(transaction as unknown as IDBTransaction, () =>
            store.data.get(key),
          ),
        put: (value: Record<string, unknown>) =>
          request(transaction as unknown as IDBTransaction, () => {
            const key = value[store.keyPath] as IDBValidKey;
            store.data.set(key, value);
            return key;
          }),
      }),
    };
    return transaction as unknown as IDBTransaction;
  }

  return {
    open: (databaseName: string) => {
      const stores = databases.get(databaseName) ?? new Map();
      const needsUpgrade = !databases.has(databaseName);
      databases.set(databaseName, stores);
      const database = {
        close: () => onClose(databaseName),
        createObjectStore: (name: string, options: { keyPath: string }) => {
          const store = { data: new Map(), keyPath: options.keyPath };
          stores.set(name, store);
          return createTransaction(store).objectStore(name);
        },
        objectStoreNames: { contains: (name: string) => stores.has(name) },
        onversionchange: null,
        transaction: (name: string) => {
          const store = stores.get(name);
          if (!store) {
            throw new Error(`Missing IndexedDB object store: ${name}`);
          }
          return createTransaction(store);
        },
      } as unknown as IDBDatabase;
      const openRequest = {
        error: null,
        onerror: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
        result: database,
      };
      queueMicrotask(() => {
        if (needsUpgrade) {
          openRequest.onupgradeneeded?.();
        }
        openRequest.onsuccess?.();
      });
      return openRequest as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

test("closing a browser keyring releases both IndexedDB connections", async () => {
  const closedDatabaseNames: string[] = [];
  const keyring = createBrowserLocalKeyring({
    indexedDB: createFakeIndexedDb((name) => closedDatabaseNames.push(name)),
  });
  await keyring.getOrCreateSession({ namespace: "test" });

  keyring.close();
  keyring.close();
  await Promise.resolve();

  expect(closedDatabaseNames.sort()).toEqual([
    "tearleads-local-keyring",
    "tearleads-local-keyring-manifests",
  ]);
  await expect(
    keyring.getOrCreateSession({ namespace: "test" }),
  ).rejects.toThrow("closed");
});
