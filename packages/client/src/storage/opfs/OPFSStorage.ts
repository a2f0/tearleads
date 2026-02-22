/**
 * OPFS (Origin Private File System) storage adapter.
 * Used on web/electron platforms.
 */

import { decrypt, encrypt, importKey } from '@tearleads/shared';
import { measureRetrieveHelper, measureStoreHelper } from './metrics';
import type { FileStorage, RetrieveMetrics, StoreMetrics } from './types';
import { getFilesDirectory } from './types';

const STREAM_FORMAT_MAGIC = new Uint8Array([
  0x54, 0x4c, 0x46, 0x53, 0x02, 0x0a
]); // "TLFS\x02\n"

interface FileSystemDirectoryEntriesHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
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

function isFileHandle(
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
): handle is FileSystemFileHandle {
  return handle.kind === 'file';
}

export class OPFSStorage implements FileStorage {
  public instanceId: string;
  private rootDirectory: FileSystemDirectoryHandle | null = null;
  private filesDirectory: FileSystemDirectoryHandle | null = null;
  private encryptionKey: CryptoKey | null = null;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  async initialize(encryptionKey: Uint8Array): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      throw new Error('OPFS is not supported in this browser');
    }

    this.rootDirectory = await navigator.storage.getDirectory();
    const directoryName = getFilesDirectory(this.instanceId);
    this.filesDirectory = await this.rootDirectory.getDirectoryHandle(
      directoryName,
      { create: true }
    );
    this.encryptionKey = await importKey(encryptionKey);
  }

  async store(id: string, data: Uint8Array): Promise<string> {
    if (!this.filesDirectory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const encrypted = await encrypt(data, this.encryptionKey);
    const filename = `${id}.enc`;

    const fileHandle = await this.filesDirectory.getFileHandle(filename, {
      create: true
    });
    const writable = await fileHandle.createWritable();
    // Copy to plain ArrayBuffer for TypeScript compatibility
    const buffer = new ArrayBuffer(encrypted.byteLength);
    new Uint8Array(buffer).set(encrypted);
    await writable.write(buffer);
    await writable.close();

    return filename;
  }

  async storeBlob(id: string, blob: Blob): Promise<string> {
    if (!this.filesDirectory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const filename = `${id}.enc`;
    const fileHandle = await this.filesDirectory.getFileHandle(filename, {
      create: true
    });
    const writable = await fileHandle.createWritable();
    await writable.write(toArrayBuffer(STREAM_FORMAT_MAGIC));

    const reader = blob.stream().getReader();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const encryptedChunk = await encrypt(value, this.encryptionKey);
        const lengthPrefix = new ArrayBuffer(4);
        new DataView(lengthPrefix).setUint32(0, encryptedChunk.byteLength, true);
        await writable.write(lengthPrefix);
        await writable.write(toArrayBuffer(encryptedChunk));
      }
    } finally {
      reader.releaseLock();
      await writable.close();
    }

    return filename;
  }

  async measureStore(
    id: string,
    data: Uint8Array,
    onMetrics?: (metrics: StoreMetrics) => void | Promise<void>
  ): Promise<string> {
    return measureStoreHelper(
      () => this.store(id, data),
      data.byteLength,
      onMetrics
    );
  }

  async measureStoreBlob(
    id: string,
    blob: Blob,
    onMetrics?: (metrics: StoreMetrics) => void | Promise<void>
  ): Promise<string> {
    return measureStoreHelper(() => this.storeBlob(id, blob), blob.size, onMetrics);
  }

  async retrieve(storagePath: string): Promise<Uint8Array> {
    if (!this.filesDirectory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const fileHandle = await this.filesDirectory.getFileHandle(storagePath);
    const file = await fileHandle.getFile();
    const encrypted = new Uint8Array(await file.arrayBuffer());
    if (isChunkedStreamFormat(encrypted)) {
      const plaintextChunks: Uint8Array[] = [];
      let cursor = STREAM_FORMAT_MAGIC.byteLength;
      while (cursor < encrypted.byteLength) {
        const remainingLengthBytes = encrypted.byteLength - cursor;
        if (remainingLengthBytes < 4) {
          throw new Error('Corrupt chunked encrypted file: missing length prefix');
        }
        const chunkLength = new DataView(
          encrypted.buffer,
          encrypted.byteOffset + cursor,
          4
        ).getUint32(0, true);
        cursor += 4;
        if (chunkLength === 0 || cursor + chunkLength > encrypted.byteLength) {
          throw new Error('Corrupt chunked encrypted file: invalid chunk length');
        }

        const encryptedChunk = encrypted.subarray(cursor, cursor + chunkLength);
        const plaintextChunk = await decrypt(encryptedChunk, this.encryptionKey);
        plaintextChunks.push(plaintextChunk);
        cursor += chunkLength;
      }
      return concatenateChunks(plaintextChunks);
    }

    return decrypt(encrypted, this.encryptionKey);
  }

  async measureRetrieve(
    storagePath: string,
    onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
  ): Promise<Uint8Array> {
    return measureRetrieveHelper(
      () => this.retrieve(storagePath),
      storagePath,
      onMetrics
    );
  }

  async delete(storagePath: string): Promise<void> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    await this.filesDirectory.removeEntry(storagePath);
  }

  async exists(storagePath: string): Promise<boolean> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    try {
      await this.filesDirectory.getFileHandle(storagePath);
      return true;
    } catch {
      return false;
    }
  }

  async getStorageUsed(): Promise<number> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    let totalSize = 0;
    const iterator = getDirectoryEntries(this.filesDirectory);
    for await (const [, handle] of iterator) {
      if (isFileHandle(handle)) {
        const file = await handle.getFile();
        totalSize += file.size;
      }
    }
    return totalSize;
  }

  async clearAll(): Promise<void> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    const entries: string[] = [];
    const iterator = getDirectoryEntries(this.filesDirectory);
    for await (const [name] of iterator) {
      entries.push(name);
    }

    for (const name of entries) {
      await this.filesDirectory.removeEntry(name);
    }
  }
}

function isChunkedStreamFormat(encrypted: Uint8Array): boolean {
  if (encrypted.byteLength < STREAM_FORMAT_MAGIC.byteLength) {
    return false;
  }
  for (let i = 0; i < STREAM_FORMAT_MAGIC.byteLength; i += 1) {
    if (encrypted[i] !== STREAM_FORMAT_MAGIC[i]) {
      return false;
    }
  }
  return true;
}

function concatenateChunks(chunks: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.byteLength;
  }
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}
