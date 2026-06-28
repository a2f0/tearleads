import { expect, test } from "bun:test";
import {
  createLocalKeyring,
  createMemoryWrappingKeyKeystore,
  createOpfsLocalKeyringManifestStore,
  type LocalKeyringScope,
} from "./localKeyring";

// Minimal in-memory OPFS supporting the main-thread API the manifest store uses:
// getDirectoryHandle / getFileHandle / removeEntry, file.getFile().text(), and
// createWritable() (write + atomic-on-close). Enough to exercise the real store.
class MemoryWritable {
  private buffer = "";
  constructor(private readonly commit: (value: string) => void) {}
  async write(data: string): Promise<void> {
    this.buffer += data;
  }
  async close(): Promise<void> {
    this.commit(this.buffer);
  }
  async abort(): Promise<void> {}
}

class MemoryFileHandle {
  readonly kind = "file";
  constructor(
    readonly name: string,
    public content: string,
  ) {}
  async getFile(): Promise<{ text: () => Promise<string> }> {
    return { text: async () => this.content };
  }
  async createWritable(): Promise<MemoryWritable> {
    return new MemoryWritable((value) => {
      this.content = value;
    });
  }
}

function notFound(): DOMException {
  return new DOMException("not found", "NotFoundError");
}

class MemoryDirectoryHandle {
  readonly kind = "directory";
  readonly dirs = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<MemoryDirectoryHandle> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options.create) {
        throw notFound();
      }
      dir = new MemoryDirectoryHandle(name);
      this.dirs.set(name, dir);
    }
    return dir;
  }
  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<MemoryFileHandle> {
    let file = this.files.get(name);
    if (!file) {
      if (!options.create) {
        throw notFound();
      }
      file = new MemoryFileHandle(name, "");
      this.files.set(name, file);
    }
    return file;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name)) {
      throw notFound();
    }
  }
}

function createMemoryOpfs(): {
  root: MemoryDirectoryHandle;
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
} {
  const root = new MemoryDirectoryHandle("");
  return {
    root,
    getDirectory: async () => root as unknown as FileSystemDirectoryHandle,
  };
}

const scope: LocalKeyringScope = {
  accountId: "user-1",
  namespace: "tearleads.sqlite",
  signingFingerprint: "fp-1",
};

test("loading or deleting a missing manifest is a no-op", async () => {
  const opfs = createMemoryOpfs();
  const store = createOpfsLocalKeyringManifestStore({
    getDirectory: opfs.getDirectory,
  });

  expect(await store.loadManifest(scope)).toBeNull();
  await store.deleteManifest(scope); // must not throw
  expect(await store.loadManifest(scope)).toBeNull();
});

test("a keyring persists and re-derives its key through the OPFS manifest store", async () => {
  const opfs = createMemoryOpfs();
  // Shared keystore so the wrapping key survives across the two keyring instances,
  // mirroring IndexedDB persisting it in a real browser.
  const keystore = createMemoryWrappingKeyKeystore();

  const first = createLocalKeyring({
    keystore,
    manifestStore: createOpfsLocalKeyringManifestStore({
      getDirectory: opfs.getDirectory,
    }),
  });
  const created = await first.getOrCreateSession(scope);
  const originalKey = created.sqliteKey;
  created.dispose();

  // The manifest is a real OPFS file under the keyring directory.
  const keyringDir = opfs.root.dirs.get("tearleads-local-keyring");
  expect(keyringDir).toBeDefined();
  expect([...(keyringDir?.files.keys() ?? [])]).toHaveLength(1);

  // A fresh keyring + fresh store over the SAME OPFS must reload the manifest and
  // derive the identical sqliteKey — exactly the cross-session stability a
  // persisted, encrypted database depends on.
  const second = createLocalKeyring({
    keystore,
    manifestStore: createOpfsLocalKeyringManifestStore({
      getDirectory: opfs.getDirectory,
    }),
  });
  const reloaded = await second.loadSession(scope);
  expect(reloaded).not.toBeNull();
  expect(reloaded?.sqliteKey).toBe(originalKey);
  reloaded?.dispose();

  // Deleting the session removes the OPFS manifest file.
  await second.deleteSession(scope);
  expect([...(keyringDir?.files.keys() ?? [])]).toHaveLength(0);
});
