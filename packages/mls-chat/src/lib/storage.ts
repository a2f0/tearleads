/**
 * IndexedDB storage for local MLS state.
 * Stores credentials, key packages, and group states client-side.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

import type { LocalKeyPackage, LocalMlsState, MlsCredential } from './types.js';

const DB_NAME = 'tearleads-mls';
const DB_VERSION = 1;

interface MlsDbSchema extends DBSchema {
  credentials: {
    key: string; // userId
    value: MlsCredential;
  };
  keyPackages: {
    key: string; // ref
    value: LocalKeyPackage;
    indexes: {
      byCreatedAt: number;
    };
  };
  groupStates: {
    key: string; // groupId
    value: LocalMlsState;
    indexes: {
      byUpdatedAt: number;
    };
  };
}

export class MlsStorage {
  private db: IDBPDatabase<MlsDbSchema> | null = null;
  private initPromise: Promise<IDBPDatabase<MlsDbSchema>> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = openDB<MlsDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Credentials store - one per user
        if (!db.objectStoreNames.contains('credentials')) {
          db.createObjectStore('credentials', { keyPath: 'userId' });
        }

        // Key packages store - multiple per user
        if (!db.objectStoreNames.contains('keyPackages')) {
          const keyPackagesStore = db.createObjectStore('keyPackages', {
            keyPath: 'ref'
          });
          keyPackagesStore.createIndex('byCreatedAt', 'createdAt');
        }

        // Group states store - one per group
        if (!db.objectStoreNames.contains('groupStates')) {
          const groupStatesStore = db.createObjectStore('groupStates', {
            keyPath: 'groupId'
          });
          groupStatesStore.createIndex('byUpdatedAt', 'updatedAt');
        }
      }
    });

    this.db = await this.initPromise;
  }

  private async getDb(): Promise<IDBPDatabase<MlsDbSchema>> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) {
      throw new Error('Failed to initialize MLS storage');
    }
    return this.db;
  }

  // Credential operations

  async getCredential(userId: string): Promise<MlsCredential | undefined> {
    const db = await this.getDb();
    return db.get('credentials', userId);
  }

  async saveCredential(credential: MlsCredential): Promise<void> {
    const db = await this.getDb();
    await db.put('credentials', credential);
  }

  async deleteCredential(userId: string): Promise<void> {
    const db = await this.getDb();
    await db.delete('credentials', userId);
  }

  // Key package operations

  async getKeyPackage(ref: string): Promise<LocalKeyPackage | undefined> {
    const db = await this.getDb();
    return db.get('keyPackages', ref);
  }

  async getAllKeyPackages(): Promise<LocalKeyPackage[]> {
    const db = await this.getDb();
    return db.getAllFromIndex('keyPackages', 'byCreatedAt');
  }

  async saveKeyPackage(keyPackage: LocalKeyPackage): Promise<void> {
    const db = await this.getDb();
    await db.put('keyPackages', keyPackage);
  }

  async deleteKeyPackage(ref: string): Promise<void> {
    const db = await this.getDb();
    await db.delete('keyPackages', ref);
  }

  async clearKeyPackages(): Promise<void> {
    const db = await this.getDb();
    await db.clear('keyPackages');
  }

  // Group state operations

  async getGroupState(groupId: string): Promise<LocalMlsState | undefined> {
    const db = await this.getDb();
    return db.get('groupStates', groupId);
  }

  async getAllGroupStates(): Promise<LocalMlsState[]> {
    const db = await this.getDb();
    return db.getAllFromIndex('groupStates', 'byUpdatedAt');
  }

  async saveGroupState(state: LocalMlsState): Promise<void> {
    const db = await this.getDb();
    await db.put('groupStates', state);
  }

  async deleteGroupState(groupId: string): Promise<void> {
    const db = await this.getDb();
    await db.delete('groupStates', groupId);
  }

  async clearGroupStates(): Promise<void> {
    const db = await this.getDb();
    await db.clear('groupStates');
  }

  // Clear all data

  async clearAll(): Promise<void> {
    const db = await this.getDb();
    await Promise.all([
      db.clear('credentials'),
      db.clear('keyPackages'),
      db.clear('groupStates')
    ]);
  }

  // Close connection

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}
