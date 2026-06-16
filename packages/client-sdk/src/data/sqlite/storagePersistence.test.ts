import { afterEach, expect, test } from "bun:test";
import {
  EPHEMERAL_STORAGE_POLICY,
  isPersistentStorageSupported,
  PERSISTENT_STORAGE_POLICY,
  requestPersistentStorage,
  resolveStoragePersistencePolicy,
} from "./storagePersistence";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("isPersistentStorageSupported is true only when getDirectory exists", () => {
  setNavigator({ storage: { getDirectory: async () => ({}) } });
  expect(isPersistentStorageSupported()).toBe(true);

  setNavigator({ storage: {} });
  expect(isPersistentStorageSupported()).toBe(false);

  setNavigator({});
  expect(isPersistentStorageSupported()).toBe(false);
});

test("resolveStoragePersistencePolicy prefers an explicit policy", () => {
  setNavigator({ storage: {} });
  expect(resolveStoragePersistencePolicy(PERSISTENT_STORAGE_POLICY)).toBe(
    PERSISTENT_STORAGE_POLICY,
  );
});

test("resolveStoragePersistencePolicy auto-detects persistent storage", () => {
  setNavigator({ storage: { getDirectory: async () => ({}) } });
  expect(resolveStoragePersistencePolicy()).toEqual(PERSISTENT_STORAGE_POLICY);

  setNavigator({ storage: {} });
  expect(resolveStoragePersistencePolicy()).toEqual(EPHEMERAL_STORAGE_POLICY);
});

test("requestPersistentStorage is a no-op for an ephemeral policy", async () => {
  let persistCalled = false;
  setNavigator({
    storage: {
      persist: async () => {
        persistCalled = true;
        return true;
      },
    },
  });

  expect(await requestPersistentStorage(EPHEMERAL_STORAGE_POLICY)).toBe(
    "not-requested",
  );
  expect(persistCalled).toBe(false);
});

test("requestPersistentStorage reports unsupported when the API is missing", async () => {
  setNavigator({ storage: {} });
  expect(await requestPersistentStorage(PERSISTENT_STORAGE_POLICY)).toBe(
    "unsupported",
  );
});

test("requestPersistentStorage short-circuits when already persisted", async () => {
  let persistCalled = false;
  setNavigator({
    storage: {
      persisted: async () => true,
      persist: async () => {
        persistCalled = true;
        return true;
      },
    },
  });

  expect(await requestPersistentStorage(PERSISTENT_STORAGE_POLICY)).toBe(
    "persisted",
  );
  expect(persistCalled).toBe(false);
});

test("requestPersistentStorage requests persistence and maps the result", async () => {
  setNavigator({
    storage: {
      persisted: async () => false,
      persist: async () => true,
    },
  });
  expect(await requestPersistentStorage(PERSISTENT_STORAGE_POLICY)).toBe(
    "persisted",
  );

  setNavigator({
    storage: {
      persisted: async () => false,
      persist: async () => false,
    },
  });
  expect(await requestPersistentStorage(PERSISTENT_STORAGE_POLICY)).toBe(
    "not-persisted",
  );
});

test("requestPersistentStorage swallows errors as unsupported", async () => {
  setNavigator({
    storage: {
      persist: async () => {
        throw new Error("boom");
      },
    },
  });
  expect(await requestPersistentStorage(PERSISTENT_STORAGE_POLICY)).toBe(
    "unsupported",
  );
});
