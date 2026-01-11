/**
 * Tests for database operations - integration tests.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigPaths, setConfigRoot } from '../config/index.js';
import { clearKey, reset } from '../crypto/key-manager.js';
import {
  changePassword,
  exportDatabase,
  getKey,
  importDatabase,
  isDatabaseSetUp,
  isDatabaseUnlocked,
  lockDatabase,
  resetDatabase,
  restoreDatabaseSession,
  setupDatabase,
  unlockDatabase
} from './index.js';

describe('database operations', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tearleads-dbops-'));
    setConfigRoot(tempDir);
    clearKey();
  });

  afterEach(async () => {
    lockDatabase();
    setConfigRoot(null);
    clearKey();
    await reset();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('setupDatabase', () => {
    it('creates database on disk', async () => {
      await setupDatabase('test-password');

      const paths = getConfigPaths();
      const stat = await fs.stat(paths.database);
      expect(stat.isFile()).toBe(true);
    });

    it('sets database as unlocked after setup', async () => {
      expect(isDatabaseUnlocked()).toBe(false);

      await setupDatabase('test-password');

      expect(isDatabaseUnlocked()).toBe(true);
    });

    it('marks database as set up', async () => {
      expect(await isDatabaseSetUp()).toBe(false);

      await setupDatabase('test-password');

      expect(await isDatabaseSetUp()).toBe(true);
    });

    it('stores encryption key', async () => {
      await setupDatabase('test-password');

      const key = getKey();
      expect(key).not.toBeNull();
      expect(key?.length).toBe(32);
    });
  });

  describe('unlockDatabase', () => {
    it('unlocks with correct password', async () => {
      await setupDatabase('test-password');
      lockDatabase();

      const success = await unlockDatabase('test-password');

      expect(success).toBe(true);
      expect(isDatabaseUnlocked()).toBe(true);
    });

    it('fails with wrong password', async () => {
      await setupDatabase('test-password');
      lockDatabase();

      const success = await unlockDatabase('wrong-password');

      expect(success).toBe(false);
      expect(isDatabaseUnlocked()).toBe(false);
    });
  });

  describe('lockDatabase', () => {
    it('locks the database', async () => {
      await setupDatabase('test-password');
      expect(isDatabaseUnlocked()).toBe(true);

      lockDatabase();

      expect(isDatabaseUnlocked()).toBe(false);
    });

    it('clears encryption key', async () => {
      await setupDatabase('test-password');
      expect(getKey()).not.toBeNull();

      lockDatabase();

      expect(getKey()).toBeNull();
    });
  });

  describe('session persistence', () => {
    it('restores session after lock', async () => {
      await setupDatabase('test-password');
      lockDatabase();

      const restored = await restoreDatabaseSession();

      expect(restored).toBe(true);
      expect(isDatabaseUnlocked()).toBe(true);
    });

    it('returns false when no persisted session', async () => {
      // Setup database
      await setupDatabase('test-password');
      lockDatabase();

      // Clear only the session, not the key data
      const { clearPersistedSession } = await import(
        '../crypto/key-manager.js'
      );
      await clearPersistedSession();

      const restored = await restoreDatabaseSession();

      expect(restored).toBe(false);
    });
  });

  describe('export/import', () => {
    it('exports database to JSON', async () => {
      await setupDatabase('test-password');

      const data = exportDatabase();

      expect(data).toHaveProperty('contacts');
      expect(data).toHaveProperty('settings');
      expect(data).toHaveProperty('events');
    });

    it('imports data into database', async () => {
      await setupDatabase('test-password');

      importDatabase({
        contacts: [{ id: 1, name: 'Test' }]
      });

      const exported = exportDatabase();
      expect(exported['contacts']).toHaveLength(1);
    });

    it('throws when database not open', () => {
      expect(() => exportDatabase()).toThrow('Database not open');
      expect(() => importDatabase({})).toThrow('Database not open');
    });
  });

  describe('changePassword', () => {
    it('changes password successfully', async () => {
      await setupDatabase('old-password');
      lockDatabase();

      const success = await changePassword('old-password', 'new-password');

      expect(success).toBe(true);
    });

    it('allows unlock with new password', async () => {
      await setupDatabase('old-password');
      await changePassword('old-password', 'new-password');
      lockDatabase();

      const success = await unlockDatabase('new-password');

      expect(success).toBe(true);
    });

    it('fails with wrong old password', async () => {
      await setupDatabase('correct-password');
      lockDatabase();

      const success = await changePassword('wrong-password', 'new-password');

      expect(success).toBe(false);
    });
  });

  describe('resetDatabase', () => {
    it('deletes database file', async () => {
      await setupDatabase('test-password');
      const paths = getConfigPaths();

      await resetDatabase();

      await expect(fs.access(paths.database)).rejects.toThrow();
    });

    it('locks database', async () => {
      await setupDatabase('test-password');
      expect(isDatabaseUnlocked()).toBe(true);

      await resetDatabase();

      expect(isDatabaseUnlocked()).toBe(false);
    });
  });
});
