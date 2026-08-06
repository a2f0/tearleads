import { expect, test } from "bun:test";
import {
  createIndexedDbLocalKeyringManifestStore,
  createLocalKeyring,
  createMemoryWrappingKeyKeystore,
  type LocalKeyringScope,
} from "./index";

// Minimal in-memory IndexedDB supporting just what the manifest store uses:
// open(name, 1) with onupgradeneeded, a keyPath object store, and get/put/delete
// requests followed by a transaction completion (the order runIndexedDbRequest
// awaits). One backing map per database name persists across open() calls so a
// reopen sees previously-written records.
function createFakeIndexedDb(): IDBFactory {
  const databases = new Map<
    string,
    Map<string, { keyPath: string; data: Map<unknown, unknown> }>
  >();

  function fire(target: { dispatch?: () => void }): void {
    queueMicrotask(() => target.dispatch?.());
  }

  function makeStore(store: {
    keyPath: string;
    data: Map<unknown, unknown>;
  }): IDBObjectStore {
    const request = <T>(run: () => T): IDBRequest<T> => {
      const handlers: {
        onsuccess: null | (() => void);
        onerror: null | (() => void);
      } = {
        onsuccess: null,
        onerror: null,
      };
      const req = {
        result: undefined as T,
        error: null as unknown,
        set onsuccess(fn: () => void) {
          handlers.onsuccess = fn;
        },
        set onerror(fn: () => void) {
          handlers.onerror = fn;
        },
      };
      fire({
        dispatch: () => {
          try {
            (req as { result: T }).result = run();
            handlers.onsuccess?.();
          } catch (error) {
            (req as { error: unknown }).error = error;
            handlers.onerror?.();
          }
        },
      });
      return req as unknown as IDBRequest<T>;
    };
    return {
      get: (key: IDBValidKey) => request(() => store.data.get(key)),
      put: (value: Record<string, unknown>) =>
        request(() => {
          const key = value[store.keyPath];
          store.data.set(key, value);
          return key as IDBValidKey;
        }),
      delete: (key: IDBValidKey) =>
        request(() => {
          store.data.delete(key);
          return undefined;
        }),
    } as unknown as IDBObjectStore;
  }

  return {
    open(name: string) {
      const stores = databases.get(name) ?? new Map();
      databases.set(name, stores);
      const handlers: {
        onupgradeneeded: null | (() => void);
        onsuccess: null | (() => void);
        onerror: null | (() => void);
      } = { onupgradeneeded: null, onsuccess: null, onerror: null };
      const database = {
        objectStoreNames: { contains: (n: string) => stores.has(n) },
        createObjectStore: (n: string, options: { keyPath: string }) => {
          stores.set(n, { keyPath: options.keyPath, data: new Map() });
        },
        transaction: (storeName: string) => {
          const store = stores.get(storeName);
          if (!store) {
            throw new Error(`No object store ${storeName}`);
          }
          const tx = {
            objectStore: () => makeStore(store),
            set oncomplete(fn: () => void) {
              fire({ dispatch: fn });
            },
            set onabort(_fn: () => void) {},
            set onerror(_fn: () => void) {},
          };
          return tx as unknown as IDBTransaction;
        },
        onversionchange: null,
        close: () => {},
      };
      const request = {
        result: database,
        error: null as unknown,
        set onupgradeneeded(fn: () => void) {
          handlers.onupgradeneeded = fn;
        },
        set onsuccess(fn: () => void) {
          handlers.onsuccess = fn;
        },
        set onerror(fn: () => void) {
          handlers.onerror = fn;
        },
      };
      fire({
        dispatch: () => {
          handlers.onupgradeneeded?.();
          handlers.onsuccess?.();
        },
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

const scope: LocalKeyringScope = {
  accountId: "user-1",
  namespace: "tearleads.sqlite",
  signingFingerprint: "fp-1",
};

test("loading or deleting a missing manifest is a no-op", async () => {
  const store = createIndexedDbLocalKeyringManifestStore({
    indexedDB: createFakeIndexedDb(),
  });

  expect(await store.loadManifest(scope)).toBeNull();
  await store.deleteManifest(scope); // must not throw
  expect(await store.loadManifest(scope)).toBeNull();
});

test("a keyring persists and re-derives its key through the IndexedDB manifest store", async () => {
  const indexedDB = createFakeIndexedDb();
  // Shared keystore so the wrapping key survives across the two keyring instances.
  const keystore = createMemoryWrappingKeyKeystore();

  const first = createLocalKeyring({
    keystore,
    manifestStore: createIndexedDbLocalKeyringManifestStore({ indexedDB }),
  });
  const created = await first.getOrCreateSession(scope);
  const originalKey = created.sqliteKey;
  created.dispose();

  // A fresh keyring + fresh store over the SAME IndexedDB must reload the manifest
  // and derive the identical sqliteKey — the cross-session stability a persisted,
  // encrypted database depends on.
  const second = createLocalKeyring({
    keystore,
    manifestStore: createIndexedDbLocalKeyringManifestStore({ indexedDB }),
  });
  const reloaded = await second.loadSession(scope);
  expect(reloaded).not.toBeNull();
  expect(reloaded?.sqliteKey).toBe(originalKey);
  reloaded?.dispose();

  // Deleting the session removes the manifest.
  await second.deleteSession(scope);
  const third = createLocalKeyring({
    keystore,
    manifestStore: createIndexedDbLocalKeyringManifestStore({ indexedDB }),
  });
  expect(await third.loadSession(scope)).toBeNull();
});
