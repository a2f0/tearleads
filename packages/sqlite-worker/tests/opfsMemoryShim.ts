// An in-memory OPFS implementation faithful enough to drive the real SQLite
// OPFS-SyncAccessHandle-Pool VFS (which is synchronous and runs on the calling
// thread, so it works under Bun with no real browser storage). It models
// `navigator.storage.getDirectory()` plus directory/file handles and
// FileSystemSyncAccessHandle, and enforces the single-open-access-handle
// exclusivity real OPFS gives each file so we can also exercise contention.
//
// The whole tree is a plain object graph so a test can snapshot the durable
// bytes, swap them, or boot a fresh "worker" from a mid-flush state to model an
// unclean shutdown.

class NoModificationAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoModificationAllowedError";
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// Test instrumentation: `onFlush` fires after each xSync/flush durability
// barrier, letting a test snapshot the state a crash could expose under
// synchronous=FULL (everything up to the last flush is durable and ordered).
export const opfsInstrumentation: { onFlush: (() => void) | null } = {
  onFlush: null,
};

class MemoryFile {
  bytes = new Uint8Array(0);
  openHandle = false;

  ensure(size: number): void {
    if (size > this.bytes.length) {
      const next = new Uint8Array(size);
      next.set(this.bytes);
      this.bytes = next;
    }
  }
}

function asUint8(buffer: ArrayBufferView): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

class MemorySyncAccessHandle {
  private closed = false;

  constructor(private readonly file: MemoryFile) {}

  read(buffer: ArrayBufferView, options: { at?: number } = {}): number {
    const at = options.at ?? 0;
    const view = asUint8(buffer);
    const end = Math.min(this.file.bytes.length, at + view.length);
    const read = Math.max(0, end - at);
    view.fill(0);
    if (read > 0) {
      view.set(this.file.bytes.subarray(at, at + read));
    }
    return read;
  }

  write(buffer: ArrayBufferView, options: { at?: number } = {}): number {
    const at = options.at ?? 0;
    const view = asUint8(buffer);
    this.file.ensure(at + view.length);
    this.file.bytes.set(view, at);
    return view.length;
  }

  truncate(size: number): void {
    if (size <= this.file.bytes.length) {
      this.file.bytes = this.file.bytes.slice(0, size);
    } else {
      this.file.ensure(size);
    }
  }

  getSize(): number {
    return this.file.bytes.length;
  }

  flush(): void {
    opfsInstrumentation.onFlush?.();
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.file.openHandle = false;
    }
  }
}

class MemoryFileHandle {
  readonly kind = "file";

  constructor(
    readonly name: string,
    readonly file: MemoryFile,
  ) {}

  async createSyncAccessHandle(): Promise<MemorySyncAccessHandle> {
    if (this.file.openHandle) {
      throw new NoModificationAllowedError(
        "Access Handles cannot be created if there is another open Access Handle on the file.",
      );
    }
    this.file.openHandle = true;
    return new MemorySyncAccessHandle(this.file);
  }
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
        throw new NotFoundError(`No directory ${name}`);
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
        throw new NotFoundError(`No file ${name}`);
      }
      file = new MemoryFileHandle(name, new MemoryFile());
      this.files.set(name, file);
    }
    return file;
  }

  async removeEntry(
    name: string,
    options: { recursive?: boolean } = {},
  ): Promise<void> {
    if (this.files.delete(name)) {
      return;
    }
    const dir = this.dirs.get(name);
    if (!dir) {
      throw new NotFoundError(`No entry ${name}`);
    }
    if (!options.recursive && (dir.dirs.size > 0 || dir.files.size > 0)) {
      throw new Error("Directory not empty");
    }
    this.dirs.delete(name);
  }

  async *entries(): AsyncGenerator<
    [string, MemoryDirectoryHandle | MemoryFileHandle]
  > {
    for (const entry of this.dirs) {
      yield entry;
    }
    for (const entry of this.files) {
      yield entry;
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<
    [string, MemoryDirectoryHandle | MemoryFileHandle]
  > {
    return this.entries();
  }
}

export interface OpfsTreeSnapshot {
  readonly dirs: Record<string, OpfsTreeSnapshot>;
  readonly files: Record<string, Uint8Array>;
}

/** A deep, serializable copy of the whole tree (the durable on-disk bytes). */
export function snapshotOpfsTree(dir: MemoryDirectoryHandle): OpfsTreeSnapshot {
  const dirs: Record<string, OpfsTreeSnapshot> = {};
  const files: Record<string, Uint8Array> = {};
  for (const [name, child] of dir.dirs) {
    dirs[name] = snapshotOpfsTree(child);
  }
  for (const [name, handle] of dir.files) {
    files[name] = handle.file.bytes.slice();
  }
  return { dirs, files };
}

function rebuildDirectory(
  name: string,
  snapshot: OpfsTreeSnapshot,
): MemoryDirectoryHandle {
  const dir = new MemoryDirectoryHandle(name);
  for (const [childName, childSnapshot] of Object.entries(snapshot.dirs)) {
    dir.dirs.set(childName, rebuildDirectory(childName, childSnapshot));
  }
  for (const [fileName, bytes] of Object.entries(snapshot.files)) {
    const file = new MemoryFile();
    file.bytes = bytes.slice();
    dir.files.set(fileName, new MemoryFileHandle(fileName, file));
  }
  return dir;
}

// The shim mutates process-wide globals (`navigator.storage`, the FileSystem*
// constructors). Bun runs all test files in one process, so we capture the
// originals on first install and restore them in `uninstallOpfsMemoryShim()` to
// keep the shim from leaking into other suites (e.g. ones that assert OPFS is
// unavailable).
const GLOBAL_KEYS = [
  "FileSystemHandle",
  "FileSystemDirectoryHandle",
  "FileSystemFileHandle",
  "navigator",
] as const;

let savedGlobals: Map<string, PropertyDescriptor | undefined> | null = null;

function captureGlobals(): void {
  if (savedGlobals) {
    return;
  }
  savedGlobals = new Map(
    GLOBAL_KEYS.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
}

function registerOpfsGlobals(): void {
  captureGlobals();
  if (Reflect.get(globalThis, "FileSystemHandle") === undefined) {
    Reflect.set(globalThis, "FileSystemHandle", class FileSystemHandle {});
  }
  Reflect.set(globalThis, "FileSystemDirectoryHandle", MemoryDirectoryHandle);
  Reflect.set(globalThis, "FileSystemFileHandle", MemoryFileHandle);
}

function mountRoot(root: MemoryDirectoryHandle): MemoryDirectoryHandle {
  const storage = { getDirectory: async () => root };
  Object.defineProperty(globalThis, "navigator", {
    value: { storage },
    configurable: true,
    writable: true,
  });
  return root;
}

/** Restore the globals the shim replaced, so it does not leak across suites. */
export function uninstallOpfsMemoryShim(): void {
  if (!savedGlobals) {
    return;
  }
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  savedGlobals = null;
}

/** Install a fresh, empty in-memory OPFS. Returns its root directory handle. */
export function installOpfsMemoryShim(): MemoryDirectoryHandle {
  registerOpfsGlobals();
  return mountRoot(new MemoryDirectoryHandle(""));
}

/**
 * Mount an OPFS whose contents are restored from a snapshot — models a fresh
 * browser session/worker booting against previously-persisted (possibly torn)
 * bytes.
 */
export function mountOpfsSnapshot(
  snapshot: OpfsTreeSnapshot,
): MemoryDirectoryHandle {
  registerOpfsGlobals();
  return mountRoot(rebuildDirectory("", snapshot));
}
