/**
 * Backup storage utilities using OPFS (Origin Private File System).
 * Stores backups outside instance-specific namespaces.
 */

import { assertPlainArrayBuffer } from '@tearleads/shared';

const BACKUP_DIRECTORY = 'tearleads-backups';

export interface StoredBackup {
  name: string;
  size: number;
  lastModified: number;
}

interface FileSystemDirectoryEntriesHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
}

function hasOpfsSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

function isFileHandle(
  handle: FileSystemDirectoryHandle | FileSystemFileHandle
): handle is FileSystemFileHandle {
  return handle.kind === 'file';
}

function hasDirectoryEntries(
  directory: FileSystemDirectoryHandle
): directory is FileSystemDirectoryEntriesHandle {
  return 'entries' in directory;
}

function getDirectoryEntries(
  directory: FileSystemDirectoryHandle
): AsyncIterableIterator<
  [string, FileSystemDirectoryHandle | FileSystemFileHandle]
> {
  if (!hasDirectoryEntries(directory)) {
    throw new Error('OPFS entries() is not supported in this environment');
  }

  return directory.entries();
}

async function getBackupDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!hasOpfsSupport()) {
    throw new Error('Backup storage is not supported on this platform');
  }

  const rootDirectory = await navigator.storage.getDirectory();
  return rootDirectory.getDirectoryHandle(BACKUP_DIRECTORY, { create: true });
}

export function isBackupStorageSupported(): boolean {
  return hasOpfsSupport();
}

export async function listStoredBackups(): Promise<StoredBackup[]> {
  const directory = await getBackupDirectory();
  const backups: StoredBackup[] = [];
  const iterator = getDirectoryEntries(directory);

  for await (const [name, handle] of iterator) {
    if (isFileHandle(handle)) {
      if (!name.endsWith('.tbu')) {
        continue;
      }
      const file = await handle.getFile();
      backups.push({
        name,
        size: file.size,
        lastModified: file.lastModified
      });
    }
  }

  backups.sort((a, b) => b.lastModified - a.lastModified);
  return backups;
}

export async function saveBackupToStorage(
  data: Uint8Array,
  filename: string
): Promise<void> {
  assertPlainArrayBuffer(data);
  const directory = await getBackupDirectory();
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function readBackupFromStorage(
  filename: string
): Promise<Uint8Array> {
  const directory = await getBackupDirectory();
  const fileHandle = await directory.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function deleteBackupFromStorage(filename: string): Promise<void> {
  const directory = await getBackupDirectory();
  await directory.removeEntry(filename);
}

export async function getBackupStorageUsed(): Promise<number> {
  const directory = await getBackupDirectory();
  let totalSize = 0;
  const iterator = getDirectoryEntries(directory);
  for await (const [, handle] of iterator) {
    if (isFileHandle(handle)) {
      const file = await handle.getFile();
      totalSize += file.size;
    }
  }
  return totalSize;
}
