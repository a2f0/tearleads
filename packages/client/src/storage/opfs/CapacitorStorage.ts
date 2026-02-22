/**
 * Capacitor Filesystem-based storage for iOS/Android.
 * Uses the app's Library directory which is hidden from the Files app
 * but still persists across app updates and is backed up.
 */

import { decrypt, encrypt, importKey } from '@tearleads/shared';
import { measureRetrieveHelper, measureStoreHelper } from './metrics';
import type { FileStorage, RetrieveMetrics, StoreMetrics } from './types';
import { getFilesDirectory } from './types';

const STREAM_FORMAT_MAGIC = new Uint8Array([
  0x54, 0x4c, 0x46, 0x53, 0x02, 0x0a
]); // "TLFS\x02\n"

export class CapacitorStorage implements FileStorage {
  public instanceId: string;
  private encryptionKey: CryptoKey | null = null;
  private filesDirectory: string;
  private Filesystem: typeof import('@capacitor/filesystem').Filesystem | null =
    null;
  private Directory: typeof import('@capacitor/filesystem').Directory | null =
    null;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.filesDirectory = getFilesDirectory(instanceId);
  }

  async initialize(encryptionKey: Uint8Array): Promise<void> {
    // Dynamically import Capacitor Filesystem to avoid loading on web
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    this.Filesystem = Filesystem;
    this.Directory = Directory;

    try {
      await this.Filesystem.mkdir({
        path: this.filesDirectory,
        directory: this.Directory.Library,
        recursive: true
      });
    } catch {
      // Directory might already exist, ignore error
    }

    this.encryptionKey = await importKey(encryptionKey);
  }

  async store(id: string, data: Uint8Array): Promise<string> {
    if (!this.Filesystem || !this.Directory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const encrypted = await encrypt(data, this.encryptionKey);
    const filename = `${id}.enc`;
    const filePath = `${this.filesDirectory}/${filename}`;

    // Convert to base64 in chunks to avoid stack overflow
    const CHUNK_SIZE = 0x8000; // 32k characters
    let binary = '';
    for (let i = 0; i < encrypted.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(encrypted.subarray(i, i + CHUNK_SIZE))
      );
    }
    const base64Data = btoa(binary);

    await this.Filesystem.writeFile({
      path: filePath,
      data: base64Data,
      directory: this.Directory.Library
    });

    return filename;
  }

  async storeBlob(id: string, blob: Blob): Promise<string> {
    if (!this.Filesystem || !this.Directory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const filename = `${id}.enc`;
    const filePath = `${this.filesDirectory}/${filename}`;

    await this.Filesystem.writeFile({
      path: filePath,
      data: bytesToBase64(STREAM_FORMAT_MAGIC),
      directory: this.Directory.Library
    });

    if (typeof blob.stream !== 'function') {
      const data = new Uint8Array(await blob.arrayBuffer());
      const encrypted = await encrypt(data, this.encryptionKey);
      const lengthPrefix = new Uint8Array(4);
      new DataView(lengthPrefix.buffer).setUint32(
        0,
        encrypted.byteLength,
        true
      );
      const payload = new Uint8Array(lengthPrefix.byteLength + encrypted.byteLength);
      payload.set(lengthPrefix, 0);
      payload.set(encrypted, lengthPrefix.byteLength);
      await this.Filesystem.appendFile({
        path: filePath,
        data: bytesToBase64(payload),
        directory: this.Directory.Library
      });
      return filename;
    }

    const reader = blob.stream().getReader();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const encryptedChunk = await encrypt(value, this.encryptionKey);
        const lengthPrefix = new Uint8Array(4);
        new DataView(lengthPrefix.buffer).setUint32(
          0,
          encryptedChunk.byteLength,
          true
        );
        const payload = new Uint8Array(
          lengthPrefix.byteLength + encryptedChunk.byteLength
        );
        payload.set(lengthPrefix, 0);
        payload.set(encryptedChunk, lengthPrefix.byteLength);

        await this.Filesystem.appendFile({
          path: filePath,
          data: bytesToBase64(payload),
          directory: this.Directory.Library
        });
      }
    } finally {
      reader.releaseLock();
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
    if (!this.Filesystem || !this.Directory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const filePath = `${this.filesDirectory}/${storagePath}`;
    const result = await this.Filesystem.readFile({
      path: filePath,
      directory: this.Directory.Library
    });

    // Convert base64 back to Uint8Array
    if (typeof result.data !== 'string') {
      throw new Error('Unexpected file data type from Capacitor Filesystem');
    }
    const encrypted = base64ToBytes(result.data);

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
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    const filePath = `${this.filesDirectory}/${storagePath}`;
    await this.Filesystem.deleteFile({
      path: filePath,
      directory: this.Directory.Library
    });
  }

  async exists(storagePath: string): Promise<boolean> {
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    try {
      const filePath = `${this.filesDirectory}/${storagePath}`;
      await this.Filesystem.stat({
        path: filePath,
        directory: this.Directory.Library
      });
      return true;
    } catch {
      return false;
    }
  }

  async getStorageUsed(): Promise<number> {
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    try {
      const result = await this.Filesystem.readdir({
        path: this.filesDirectory,
        directory: this.Directory.Library
      });

      let totalSize = 0;
      for (const file of result.files) {
        if (file.type === 'file') {
          const stat = await this.Filesystem.stat({
            path: `${this.filesDirectory}/${file.name}`,
            directory: this.Directory.Library
          });
          totalSize += stat.size;
        }
      }
      return totalSize;
    } catch {
      return 0;
    }
  }

  async clearAll(): Promise<void> {
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    try {
      const result = await this.Filesystem.readdir({
        path: this.filesDirectory,
        directory: this.Directory.Library
      });

      for (const file of result.files) {
        if (file.type === 'file') {
          await this.Filesystem.deleteFile({
            path: `${this.filesDirectory}/${file.name}`,
            directory: this.Directory.Library
          });
        }
      }
    } catch {
      // Directory might not exist, ignore
    }
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
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
