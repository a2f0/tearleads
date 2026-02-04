import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteBackupFromStorage,
  getBackupStorageUsed,
  isBackupStorageSupported,
  listStoredBackups,
  readBackupFromStorage,
  saveBackupToStorage
} from './backup-storage';

type MockWritableStream = {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type MockFileHandle = {
  kind: 'file';
  name: string;
  _data: Uint8Array;
  getFile: ReturnType<typeof vi.fn>;
  createWritable: ReturnType<typeof vi.fn>;
  isSameEntry: ReturnType<typeof vi.fn>;
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
};

type MockDirectoryHandle = {
  kind: 'directory';
  name: string;
  getFileHandle: ReturnType<typeof vi.fn>;
  getDirectoryHandle: ReturnType<typeof vi.fn>;
  removeEntry: ReturnType<typeof vi.fn>;
  entries: ReturnType<typeof vi.fn>;
  isSameEntry: ReturnType<typeof vi.fn>;
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
};

type MockHandle = MockFileHandle | MockDirectoryHandle;

const createMockFileHandle = (
  name: string,
  data: Uint8Array
): MockFileHandle => {
  const file = {
    arrayBuffer: async () => data.buffer,
    size: data.byteLength,
    lastModified: Date.now()
  };
  const write = vi.fn(async (chunk: ArrayBuffer | Uint8Array) => {
    if (chunk instanceof ArrayBuffer) {
      file.arrayBuffer = async () => chunk;
      file.size = chunk.byteLength;
      return;
    }
    if (chunk instanceof Uint8Array) {
      file.arrayBuffer = async () => chunk.buffer;
      file.size = chunk.byteLength;
    }
  });
  const close = vi.fn();
  const createWritable = vi.fn(
    async (): Promise<MockWritableStream> => ({
      write,
      close
    })
  );

  return {
    kind: 'file',
    name,
    _data: data,
    getFile: vi.fn(async () => file),
    createWritable,
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn()
  };
};

const createMockDirectoryHandle = (
  name: string,
  files: Map<string, MockHandle> = new Map()
): MockDirectoryHandle => {
  const getFileHandle = vi.fn(
    async (fileName: string, options?: { create?: boolean }) => {
      const existing = files.get(fileName);
      if (existing && existing.kind === 'file') {
        return existing;
      }
      if (options?.create) {
        const handle = createMockFileHandle(fileName, new Uint8Array());
        files.set(fileName, handle);
        return handle;
      }
      throw new Error('File not found');
    }
  );

  const removeEntry = vi.fn(async (fileName: string) => {
    files.delete(fileName);
  });

  const entries = vi.fn(async function* () {
    for (const [entryName, handle] of files.entries()) {
      yield [entryName, handle] as [string, MockHandle];
    }
  });

  return {
    kind: 'directory',
    name,
    getFileHandle,
    getDirectoryHandle: vi.fn(async () => {
      throw new Error('Nested directory not expected');
    }),
    removeEntry,
    entries,
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn()
  };
};

describe('backup-storage', () => {
  let backupDirectory: MockDirectoryHandle;

  beforeEach(() => {
    const fileMap = new Map<string, MockHandle>();
    fileMap.set(
      'existing-backup.rbu',
      createMockFileHandle('existing-backup.rbu', new Uint8Array([1, 2, 3]))
    );
    fileMap.set(
      'notes.txt',
      createMockFileHandle('notes.txt', new Uint8Array([9]))
    );
    fileMap.set('nested', createMockDirectoryHandle('nested'));
    backupDirectory = createMockDirectoryHandle('rapid-backups', fileMap);

    const rootDirectory: MockDirectoryHandle = {
      kind: 'directory',
      name: 'root',
      getFileHandle: vi.fn(async () => {
        throw new Error('Root should not open files');
      }),
      getDirectoryHandle: vi.fn(async () => backupDirectory),
      removeEntry: vi.fn(),
      entries: vi.fn(async function* () {
        yield* [];
      }),
      isSameEntry: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn()
    };

    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {
        getDirectory: vi.fn(async () => rootDirectory)
      },
      configurable: true
    });
  });

  it('reports OPFS support when storage directory is available', () => {
    expect(isBackupStorageSupported()).toBe(true);
  });

  it('reports unsupported when storage directory is missing', () => {
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {},
      configurable: true
    });
    expect(isBackupStorageSupported()).toBe(false);
  });

  it('lists only .rbu backups', async () => {
    const backups = await listStoredBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]?.name).toBe('existing-backup.rbu');
  });

  it('saves and reads a backup file', async () => {
    const data = new Uint8Array([4, 5, 6]);
    await saveBackupToStorage(data, 'new-backup.rbu');

    const read = await readBackupFromStorage('new-backup.rbu');
    expect(read).toEqual(data);
  });

  it('deletes a backup file', async () => {
    await deleteBackupFromStorage('existing-backup.rbu');
    const backups = await listStoredBackups();
    expect(backups).toHaveLength(0);
  });

  it('computes backup storage usage', async () => {
    const used = await getBackupStorageUsed();
    expect(used).toBeGreaterThan(0);
  });

  it('throws when storage is unsupported', async () => {
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {},
      configurable: true
    });

    await expect(listStoredBackups()).rejects.toThrow(
      'Backup storage is not supported on this platform'
    );
  });

  it('throws when entries() is unsupported', async () => {
    const rootDirectory: MockDirectoryHandle = {
      kind: 'directory',
      name: 'root',
      getFileHandle: vi.fn(async () => {
        throw new Error('Root should not open files');
      }),
      getDirectoryHandle: vi.fn(async () => ({
        kind: 'directory',
        name: 'rapid-backups',
        getFileHandle: vi.fn(),
        getDirectoryHandle: vi.fn(),
        removeEntry: vi.fn(),
        isSameEntry: vi.fn(),
        queryPermission: vi.fn(),
        requestPermission: vi.fn()
      })),
      removeEntry: vi.fn(),
      entries: vi.fn(async function* () {
        yield* [];
      }),
      isSameEntry: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn()
    };

    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {
        getDirectory: vi.fn(async () => rootDirectory)
      },
      configurable: true
    });

    await expect(listStoredBackups()).rejects.toThrow(
      'OPFS entries() is not supported in this environment'
    );
  });
});
