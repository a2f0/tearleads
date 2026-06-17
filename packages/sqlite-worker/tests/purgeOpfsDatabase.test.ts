import { afterEach, expect, test } from "bun:test";
import { persistentSahPoolStorageForDbName } from "../src/loadSqlite3";
import { purgeOpfsSqliteDatabase } from "../src/purgeOpfsDatabase";

class FakeDirectoryHandle {
  readonly directories = new Map<string, FakeDirectoryHandle>();

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) {
      return existing;
    }
    if (!options?.create) {
      throw new DOMException("Directory not found", "NotFoundError");
    }
    const directory = new FakeDirectoryHandle();
    this.directories.set(name, directory);
    return directory;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.directories.delete(name)) {
      throw new DOMException("Entry not found", "NotFoundError");
    }
  }
}

let restoreNavigator: (() => void) | null = null;

function installFakeOpfs(root: FakeDirectoryHandle): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { getDirectory: async () => root } },
  });
  restoreNavigator = () => {
    if (previous) {
      Object.defineProperty(globalThis, "navigator", previous);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  };
}

afterEach(() => {
  restoreNavigator?.();
  restoreNavigator = null;
});

// Build the OPFS directory tree the SAHPool would create for a db name, so the
// test stays in lockstep with the real path derivation.
function seedSahPoolDirectory(
  root: FakeDirectoryHandle,
  dbName: string,
): { parent: FakeDirectoryHandle; leaf: string } {
  const { directory } = persistentSahPoolStorageForDbName(dbName);
  const segments = directory.split("/").filter((segment) => segment.length > 0);
  let dir = root;
  for (const segment of segments) {
    const next = new FakeDirectoryHandle();
    dir.directories.set(segment, next);
    dir = next;
  }
  // Return the parent of the leaf so the test can assert it was removed.
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = parent.directories.get(segment) as FakeDirectoryHandle;
  }
  return { leaf: segments[segments.length - 1] as string, parent };
}

test("purgeOpfsSqliteDatabase removes the database's SAHPool directory", async () => {
  const root = new FakeDirectoryHandle();
  const { parent, leaf } = seedSahPoolDirectory(root, "/app-identity-abc.db");
  installFakeOpfs(root);
  expect(parent.directories.has(leaf)).toBe(true);

  await purgeOpfsSqliteDatabase("/app-identity-abc.db");

  expect(parent.directories.has(leaf)).toBe(false);
});

test("purgeOpfsSqliteDatabase is a no-op when the directory is absent", async () => {
  const root = new FakeDirectoryHandle();
  installFakeOpfs(root);

  // Nothing seeded: must resolve without throwing (NotFoundError swallowed).
  await expect(
    purgeOpfsSqliteDatabase("/app-identity-missing.db"),
  ).resolves.toBeUndefined();
});

test("purgeOpfsSqliteDatabase is a no-op when OPFS is unavailable", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  restoreNavigator = () => {
    if (previous) {
      Object.defineProperty(globalThis, "navigator", previous);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  };

  await expect(
    purgeOpfsSqliteDatabase("/app-identity-abc.db"),
  ).resolves.toBeUndefined();
});
