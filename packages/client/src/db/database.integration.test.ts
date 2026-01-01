/**
 * Integration tests for database operations.
 *
 * These tests use the vitest integration test infrastructure with real SQLite
 * operations via NodeAdapter. They replace slower Playwright E2E tests for
 * core database functionality.
 */

// Import integration setup FIRST - this sets up mocks for adapters and key manager
import '../test/setup-integration';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetTestKeyManager } from '../test/test-key-manager';
import {
  changePassword,
  clearPersistedSession,
  closeDatabase,
  getDatabase,
  getDatabaseAdapter,
  hasPersistedSession,
  isDatabaseSetUp,
  resetDatabase,
  restoreDatabaseSession,
  setupDatabase,
  unlockDatabase,
  userSettings
} from '.';

const TEST_PASSWORD = 'test-password-123';
const NEW_PASSWORD = 'new-password-456';
const TEST_INSTANCE_ID = 'test-instance';

describe('Database Integration Tests', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
  });

  describe('setupDatabase', () => {
    it('sets up a new database with password', async () => {
      const db = await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      expect(db).toBeDefined();
      expect(await isDatabaseSetUp(TEST_INSTANCE_ID)).toBe(true);
    });

    it('throws if database already initialized', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      await expect(
        setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID)
      ).rejects.toThrow('Database already initialized');
    });

    it('creates schema tables during setup', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const adapter = getDatabaseAdapter();
      const result = await adapter.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );

      const tableNames = result.rows.map(
        (row: Record<string, unknown>) => row['name']
      );
      expect(tableNames).toContain('contacts');
      expect(tableNames).toContain('user_settings');
      expect(tableNames).toContain('files');
      expect(tableNames).toContain('analytics_events');
    });
  });

  describe('unlockDatabase', () => {
    it('unlocks an existing database', async () => {
      // Setup first
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();

      // Unlock
      const result = await unlockDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      expect(result).not.toBeNull();
      expect(result?.db).toBeDefined();
    });

    it('returns existing db if already unlocked', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const result = await unlockDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      expect(result).not.toBeNull();
      expect(result?.db).toBeDefined();
    });
  });

  describe('closeDatabase', () => {
    it('closes the database and clears instance', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();

      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('allows re-unlocking after close', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();

      const result = await unlockDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      expect(result?.db).toBeDefined();
    });
  });

  describe('data persistence', () => {
    it('persists data within the same session', async () => {
      // Setup and write data
      const db = await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const testKey = 'test_persistence_key';
      const testValue = `test-value-${Date.now()}`;

      await db
        .insert(userSettings)
        .values({
          key: testKey,
          value: testValue,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: userSettings.key,
          set: { value: testValue, updatedAt: new Date() }
        });

      // Verify data is immediately readable
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.key, testKey));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.value).toBe(testValue);
    });

    // Note: Data persistence across lock/unlock cycles requires OPFS (web)
    // or file-based storage (Electron). This is covered by Playwright E2E tests.
    // The NodeAdapter uses temp files that don't persist across adapter instances.
  });

  describe('write and read operations', () => {
    it('writes and reads data using Drizzle ORM', async () => {
      const db = await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const testKey = 'drizzle_test_key';
      const testValue = 'drizzle_test_value';

      // Write using Drizzle
      await db.insert(userSettings).values({
        key: testKey,
        value: testValue,
        updatedAt: new Date()
      });

      // Read using Drizzle
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.key, testKey));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.value).toBe(testValue);
    });

    it('writes and reads data using raw SQL', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      const adapter = getDatabaseAdapter();

      const testKey = 'raw_sql_test_key';
      const testValue = 'raw_sql_test_value';

      // Write using raw SQL
      await adapter.execute(
        'INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)',
        [testKey, testValue, Date.now()]
      );

      // Read using raw SQL
      const result = await adapter.execute(
        'SELECT value FROM user_settings WHERE key = ?',
        [testKey]
      );

      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as Record<string, unknown>)['value']).toBe(
        testValue
      );
    });

    it('handles INSERT OR REPLACE correctly', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      const adapter = getDatabaseAdapter();

      const testKey = 'replace_test_key';

      // Insert initial value
      await adapter.execute(
        'INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)',
        [testKey, 'initial_value', Date.now()]
      );

      // Replace with new value
      await adapter.execute(
        'INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)',
        [testKey, 'replaced_value', Date.now()]
      );

      // Should have only one row with the new value
      const result = await adapter.execute(
        'SELECT value FROM user_settings WHERE key = ?',
        [testKey]
      );

      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as Record<string, unknown>)['value']).toBe(
        'replaced_value'
      );
    });
  });

  describe('changePassword', () => {
    it('changes password successfully', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const success = await changePassword(TEST_PASSWORD, NEW_PASSWORD);

      expect(success).toBe(true);
    });

    it('preserves data after password change', async () => {
      const db = await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      // Write test data
      const testKey = 'password_change_test';
      const testValue = 'preserved_value';
      await db.insert(userSettings).values({
        key: testKey,
        value: testValue,
        updatedAt: new Date()
      });

      // Change password
      await changePassword(TEST_PASSWORD, NEW_PASSWORD);

      // Read data back
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.key, testKey));

      expect(rows[0]?.value).toBe(testValue);
    });

    it('throws if database not initialized', async () => {
      await expect(changePassword(TEST_PASSWORD, NEW_PASSWORD)).rejects.toThrow(
        'Database not initialized'
      );
    });
  });

  describe('resetDatabase', () => {
    it('clears all data and state', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await resetDatabase(TEST_INSTANCE_ID);

      expect(await isDatabaseSetUp(TEST_INSTANCE_ID)).toBe(false);
      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('allows setting up again after reset', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await resetDatabase(TEST_INSTANCE_ID);

      const db = await setupDatabase(NEW_PASSWORD, TEST_INSTANCE_ID);

      expect(db).toBeDefined();
      expect(await isDatabaseSetUp(TEST_INSTANCE_ID)).toBe(true);
    });
  });

  describe('session persistence', () => {
    it('reports no persisted session initially', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      expect(await hasPersistedSession(TEST_INSTANCE_ID)).toBe(false);
    });

    it('persists session when unlock is called with persistSession=true', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();

      const result = await unlockDatabase(
        TEST_PASSWORD,
        TEST_INSTANCE_ID,
        true
      );

      expect(result?.sessionPersisted).toBe(true);
      expect(await hasPersistedSession(TEST_INSTANCE_ID)).toBe(true);
    });

    it('restores session from persisted state', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();
      await unlockDatabase(TEST_PASSWORD, TEST_INSTANCE_ID, true);
      await closeDatabase();

      const db = await restoreDatabaseSession(TEST_INSTANCE_ID);

      expect(db).toBeDefined();
    });

    it('returns null when no persisted session exists', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();

      const db = await restoreDatabaseSession(TEST_INSTANCE_ID);

      expect(db).toBeNull();
    });

    it('clears persisted session', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();
      await unlockDatabase(TEST_PASSWORD, TEST_INSTANCE_ID, true);
      await clearPersistedSession(TEST_INSTANCE_ID);

      expect(await hasPersistedSession(TEST_INSTANCE_ID)).toBe(false);
    });

    it('clears persisted session on database reset', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      await closeDatabase();
      await unlockDatabase(TEST_PASSWORD, TEST_INSTANCE_ID, true);
      await resetDatabase(TEST_INSTANCE_ID);

      expect(await hasPersistedSession(TEST_INSTANCE_ID)).toBe(false);
    });
  });

  describe('error handling', () => {
    it('getDatabase throws when not initialized', () => {
      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('getDatabaseAdapter throws when not initialized', () => {
      expect(() => getDatabaseAdapter()).toThrow('Database not initialized');
    });
  });
});
