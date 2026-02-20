/**
 * Capacitor Filesystem-based storage for iOS/Android.
 * Uses the app's Library directory which is hidden from the Files app
 * but still persists across app updates and is backed up.
 */

import { decrypt, encrypt, importKey } from '@tearleads/shared';
import { measureRetrieveHelper, measureStoreHelper } from './metrics';
import type { FileStorage, RetrieveMetrics, StoreMetrics } from './types';
import { getFilesDirectory } from './types';

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
    const binary = atob(result.data);
    const encrypted = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      encrypted[i] = binary.charCodeAt(i);
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
