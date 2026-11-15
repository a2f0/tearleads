import { afterEach, expect, test } from "bun:test";
import { wipeOpfsStorage } from "../src/wipeOpfsStorage";
import {
  installOpfsMemoryShim,
  snapshotOpfsTree,
  uninstallOpfsMemoryShim,
} from "./opfsMemoryShim";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

afterEach(() => {
  uninstallOpfsMemoryShim();
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

function mountNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
    writable: true,
  });
}

// An OPFS root holding one entry whose removal fails `failures` times, as when
// the previous page's worker has not released its access handles yet.
function mountRootWithBusyEntry(failures: number): { removals: () => number } {
  let removals = 0;
  const root = {
    async *entries() {
      yield ["tearleads-sqlite", {}] as const;
    },
    async removeEntry() {
      removals += 1;
      if (removals <= failures) {
        const error = new Error("An access handle is still open.");
        error.name = "NoModificationAllowedError";
        throw error;
      }
    },
  };
  mountNavigator({ storage: { getDirectory: async () => root } });
  return { removals: () => removals };
}

test("wipeOpfsStorage removes every database, blob, and file in the OPFS root", async () => {
  const root = installOpfsMemoryShim();
  const databases = await root.getDirectoryHandle("tearleads-sqlite", {
    create: true,
  });
  await databases.getDirectoryHandle("app-identity-abc.db", { create: true });
  const blobs = await root.getDirectoryHandle("tearleads", { create: true });
  await blobs.getFileHandle("photo.blob", { create: true });
  await root.getFileHandle("desktop-state.json", { create: true });

  expect(await wipeOpfsStorage()).toBe("wiped");

  expect(snapshotOpfsTree(root)).toEqual({ dirs: {}, files: {} });
});

test("wipeOpfsStorage reports a context without OPFS", async () => {
  mountNavigator({});

  expect(await wipeOpfsStorage()).toBe("unavailable");
});

test("wipeOpfsStorage waits out access handles a terminated worker still holds", async () => {
  const root = mountRootWithBusyEntry(2);

  expect(await wipeOpfsStorage({ attempts: 3, retryDelayMs: 1 })).toBe("wiped");
  expect(root.removals()).toBe(3);
});

test("wipeOpfsStorage fails naming the entry when its handles are never released", async () => {
  mountRootWithBusyEntry(Number.POSITIVE_INFINITY);

  const failure = await wipeOpfsStorage({ attempts: 2, retryDelayMs: 1 }).then(
    () => null,
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe(
    'Could not remove "tearleads-sqlite" from OPFS.',
  );
  expect(((failure as Error).cause as Error).name).toBe(
    "NoModificationAllowedError",
  );
});
