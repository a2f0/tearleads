import { afterEach, expect, test } from "bun:test";
import {
  completeDeviceReset,
  type DeviceResetEnvironment,
  isDeviceResetRequested,
  isWorkerStorageWipePending,
  requestDeviceReset,
} from "./deviceReset";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

type IndexedDbFactory = NonNullable<DeviceResetEnvironment["indexedDB"]>;

// IndexedDB as the reset sees it: a database list, and deletions that succeed
// or fail as each test needs.
function fakeIndexedDb(
  names: string[],
  failingName?: string,
): { deleted: string[]; factory: IndexedDbFactory } {
  const deleted: string[] = [];
  const factory: IndexedDbFactory = {
    databases: async () => names.map((name) => ({ name, version: 1 })),
    deleteDatabase: (name) => {
      const request = {
        error: null as DOMException | null,
        onerror: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
      };
      queueMicrotask(() => {
        if (name === failingName) {
          request.error = new DOMException("disk full", "UnknownError");
          request.onerror?.();
          return;
        }
        deleted.push(name);
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  };
  return { deleted, factory };
}

function seedDeviceData(): void {
  localStorage.setItem("tearleads.theme.choice", "dark");
  localStorage.setItem("tearleads.local-identity-registry:tearleads.app", "{}");
  sessionStorage.setItem("tearleads.documents.session-peer-seed", "7");
  requestDeviceReset(localStorage, () => {});
}

test("a device reset wipes OPFS, every IndexedDB database, and both storages", async () => {
  seedDeviceData();
  const indexedDb = fakeIndexedDb([
    "tearleads-local-keyring",
    "tearleads-local-keyring-manifests",
  ]);
  let opfsWiped = false;

  await completeDeviceReset({
    indexedDB: indexedDb.factory,
    localStorage,
    sessionStorage,
    wipeOpfs: async () => {
      opfsWiped = true;
      return "wiped";
    },
  });

  expect(opfsWiped).toBe(true);
  expect(indexedDb.deleted).toEqual([
    "tearleads-local-keyring",
    "tearleads-local-keyring-manifests",
  ]);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(isDeviceResetRequested()).toBe(false);
  expect(isWorkerStorageWipePending()).toBe(false);
});

test("without main-thread OPFS the reset leaves the OPFS wipe to the database worker", async () => {
  seedDeviceData();

  await completeDeviceReset({
    indexedDB: fakeIndexedDb([]).factory,
    localStorage,
    sessionStorage,
    wipeOpfs: async () => "unavailable",
  });

  expect(isWorkerStorageWipePending()).toBe(true);
  expect(localStorage.length).toBe(1);
  expect(isDeviceResetRequested()).toBe(false);
});

test("a failed wipe keeps the request and the data so a retry can finish it", async () => {
  seedDeviceData();
  const indexedDb = fakeIndexedDb(
    ["tearleads-local-keyring", "tearleads-local-keyring-manifests"],
    "tearleads-local-keyring",
  );

  await expect(
    completeDeviceReset({
      indexedDB: indexedDb.factory,
      localStorage,
      sessionStorage,
      wipeOpfs: async () => "wiped",
    }),
  ).rejects.toThrow("disk full");

  expect(isDeviceResetRequested()).toBe(true);
  expect(localStorage.getItem("tearleads.theme.choice")).toBe("dark");
  expect(sessionStorage.length).toBe(1);
});
