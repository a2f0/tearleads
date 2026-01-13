/**
 * Unit tests for database API.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockAdapter = {
  initialize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isOpen: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  executeMany: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  commitTransaction: ReturnType<typeof vi.fn>;
  rollbackTransaction: ReturnType<typeof vi.fn>;
  rekeyDatabase: ReturnType<typeof vi.fn>;
  getConnection: ReturnType<typeof vi.fn>;
  deleteDatabase: ReturnType<typeof vi.fn>;
  exportDatabase: ReturnType<typeof vi.fn> | undefined;
  importDatabase: ReturnType<typeof vi.fn> | undefined;
  terminate: ReturnType<typeof vi.fn>;
};

// Mock the adapters module
const mockAdapter: MockAdapter = {
  initialize: vi.fn(),
  close: vi.fn(),
  isOpen: vi.fn(() => true),
  execute: vi.fn(),
  executeMany: vi.fn(),
  beginTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  rekeyDatabase: vi.fn(),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  deleteDatabase: vi.fn(),
  exportDatabase: vi.fn(async () => new Uint8Array([1, 2, 3])),
  importDatabase: vi.fn(),
  terminate: vi.fn()
};

vi.mock('./adapters', () => ({
  createAdapter: vi.fn(async () => mockAdapter),
  getPlatformInfo: vi.fn(() => ({
    platform: 'web',
    supportsNativeEncryption: false,
    requiresWebWorker: true
  }))
}));

// Mock the key manager
type MockKeyManager = {
  hasExistingKey: ReturnType<typeof vi.fn>;
  setupNewKey: ReturnType<typeof vi.fn>;
  unlockWithPassword: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
  getCurrentKey: ReturnType<typeof vi.fn>;
  clearKey: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  persistSession: ReturnType<typeof vi.fn>;
  hasPersistedSession: ReturnType<typeof vi.fn>;
  restoreSession: ReturnType<typeof vi.fn>;
  clearPersistedSession: ReturnType<typeof vi.fn>;
};

const mockKeyManager: MockKeyManager = {
  hasExistingKey: vi.fn(async () => false),
  setupNewKey: vi.fn(async () => new Uint8Array(32)),
  unlockWithPassword: vi.fn(async () => new Uint8Array(32)),
  changePassword: vi.fn(async () => ({
    oldKey: new Uint8Array(32),
    newKey: new Uint8Array(32)
  })),
  getCurrentKey: vi.fn(() => null),
  clearKey: vi.fn(),
  reset: vi.fn(),
  persistSession: vi.fn(async () => true),
  hasPersistedSession: vi.fn(async () => false),
  restoreSession: vi.fn(async () => null),
  clearPersistedSession: vi.fn()
};

vi.mock('./crypto', () => ({
  getKeyManagerForInstance: vi.fn(() => mockKeyManager),
  setCurrentInstanceId: vi.fn()
}));

// Import after mocks are set up
import {
  changePassword,
  closeDatabase,
  exportDatabase,
  clearPersistedSession,
  getCurrentPlatform,
  getDatabase,
  getDatabaseAdapter,
  importDatabase,
  isDatabaseSetUp,
  persistDatabaseSession,
  resetDatabase,
  setupDatabase,
  unlockDatabase
} from './index';

const TEST_INSTANCE_ID = 'test-instance';

describe('Database API', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the module state by re-importing
    // Since we can't easily reset module state, we'll reset via resetDatabase
    try {
      await resetDatabase(TEST_INSTANCE_ID);
    } catch {
      // Ignore errors from reset
    }
  });

  describe('getCurrentPlatform', () => {
    it('returns platform info', () => {
      const platform = getCurrentPlatform();
      expect(platform).toEqual({
        platform: 'web',
        supportsNativeEncryption: false,
        requiresWebWorker: true
      });
    });
  });

  describe('isDatabaseSetUp', () => {
    it('returns false when no key exists', async () => {
      mockKeyManager.hasExistingKey.mockResolvedValueOnce(false);
      const result = await isDatabaseSetUp(TEST_INSTANCE_ID);
      expect(result).toBe(false);
    });

    it('returns true when key exists', async () => {
      mockKeyManager.hasExistingKey.mockResolvedValueOnce(true);
      const result = await isDatabaseSetUp(TEST_INSTANCE_ID);
      expect(result).toBe(true);
    });
  });

  describe('setupDatabase', () => {
    it('creates encryption key and initializes database', async () => {
      const db = await setupDatabase('password123', TEST_INSTANCE_ID);

      expect(mockKeyManager.setupNewKey).toHaveBeenCalledWith('password123');
      expect(mockAdapter.initialize).toHaveBeenCalled();
      expect(db).toBeDefined();
    });

    it('runs migrations after initialization', async () => {
      await setupDatabase('password123', TEST_INSTANCE_ID);
      expect(mockAdapter.executeMany).toHaveBeenCalled();
    });

    it('throws if database already initialized', async () => {
      await setupDatabase('password123', TEST_INSTANCE_ID);
      await expect(
        setupDatabase('password123', TEST_INSTANCE_ID)
      ).rejects.toThrow('Database already initialized');
    });
  });

  describe('unlockDatabase', () => {
    it('returns null for wrong password', async () => {
      mockKeyManager.unlockWithPassword.mockResolvedValueOnce(null);
      const result = await unlockDatabase('wrongpassword', TEST_INSTANCE_ID);
      expect(result).toBeNull();
    });

    it('initializes database with correct password', async () => {
      const result = await unlockDatabase('correctpassword', TEST_INSTANCE_ID);

      expect(mockKeyManager.unlockWithPassword).toHaveBeenCalledWith(
        'correctpassword'
      );
      expect(mockAdapter.initialize).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.db).toBeDefined();
      expect(result?.sessionPersisted).toBe(false);
    });

    it('returns existing database if already unlocked', async () => {
      const result1 = await unlockDatabase('password', TEST_INSTANCE_ID);
      const result2 = await unlockDatabase('password', TEST_INSTANCE_ID);

      expect(result1?.db).toBe(result2?.db);
      // Should only initialize once
      expect(mockAdapter.initialize).toHaveBeenCalledTimes(1);
    });

    it('returns sessionPersisted true when persist succeeds', async () => {
      mockKeyManager.persistSession.mockResolvedValueOnce(true);
      const result = await unlockDatabase('password', TEST_INSTANCE_ID, true);

      expect(result?.sessionPersisted).toBe(true);
      expect(mockKeyManager.persistSession).toHaveBeenCalled();
    });

    it('returns sessionPersisted false when persist fails', async () => {
      mockKeyManager.persistSession.mockResolvedValueOnce(false);
      const result = await unlockDatabase('password', TEST_INSTANCE_ID, true);

      expect(result?.sessionPersisted).toBe(false);
    });
  });

  describe('persistDatabaseSession', () => {
    it('persists the current session for the instance', async () => {
      mockKeyManager.persistSession.mockResolvedValueOnce(true);
      const result = await persistDatabaseSession(TEST_INSTANCE_ID);

      expect(mockKeyManager.persistSession).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('returns false when persistence fails', async () => {
      mockKeyManager.persistSession.mockResolvedValueOnce(false);
      const result = await persistDatabaseSession(TEST_INSTANCE_ID);

      expect(result).toBe(false);
    });
  });

  describe('clearPersistedSession', () => {
    it('clears persisted session for the instance', async () => {
      await clearPersistedSession(TEST_INSTANCE_ID);

      expect(mockKeyManager.clearPersistedSession).toHaveBeenCalled();
    });
  });

  describe('getDatabase', () => {
    it('throws if database not initialized', async () => {
      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('returns database instance after setup', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      const db = getDatabase();
      expect(db).toBeDefined();
    });
  });

  describe('getDatabaseAdapter', () => {
    it('throws if database not initialized', async () => {
      expect(() => getDatabaseAdapter()).toThrow('Database not initialized');
    });

    it('returns adapter after setup', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      const adapter = getDatabaseAdapter();
      expect(adapter).toBeDefined();
    });
  });

  describe('closeDatabase', () => {
    it('closes the adapter', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      await closeDatabase();

      expect(mockAdapter.close).toHaveBeenCalled();
      expect(mockKeyManager.clearKey).toHaveBeenCalled();
    });

    it('clears the database instance', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      await closeDatabase();

      expect(() => getDatabase()).toThrow('Database not initialized');
    });
  });

  describe('changePassword', () => {
    it('throws if database not initialized', async () => {
      await expect(changePassword('old', 'new')).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('returns false for wrong old password', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      mockKeyManager.changePassword.mockResolvedValueOnce(null);

      const result = await changePassword('wrongpassword', 'newpassword');
      expect(result).toBe(false);
    });

    it('rekeys database on successful password change', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);

      const result = await changePassword('oldpassword', 'newpassword');

      expect(result).toBe(true);
      expect(mockKeyManager.changePassword).toHaveBeenCalledWith(
        'oldpassword',
        'newpassword'
      );
      expect(mockAdapter.rekeyDatabase).toHaveBeenCalled();
    });
  });

  describe('resetDatabase', () => {
    it('closes database and deletes files', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      await resetDatabase(TEST_INSTANCE_ID);

      expect(mockAdapter.close).toHaveBeenCalled();
      expect(mockAdapter.deleteDatabase).toHaveBeenCalledWith(
        `rapid-${TEST_INSTANCE_ID}`
      );
      expect(mockKeyManager.reset).toHaveBeenCalled();
    });

    it('terminates worker on web platform', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      await resetDatabase(TEST_INSTANCE_ID);

      expect(mockAdapter.terminate).toHaveBeenCalled();
    });
  });

  describe('exportDatabase', () => {
    it('throws if database not initialized', async () => {
      await expect(exportDatabase()).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('returns exported data', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      const data = await exportDatabase();

      expect(mockAdapter.exportDatabase).toHaveBeenCalled();
      expect(data).toBeInstanceOf(Uint8Array);
    });

    it('throws if export not supported', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);

      // Temporarily remove exportDatabase
      const originalExport = mockAdapter.exportDatabase;
      mockAdapter.exportDatabase = undefined;

      await expect(exportDatabase()).rejects.toThrow(
        'Export not supported on this platform'
      );

      mockAdapter.exportDatabase = originalExport;
    });
  });

  describe('importDatabase', () => {
    it('throws if database not initialized', async () => {
      await expect(importDatabase(new Uint8Array([1, 2, 3]))).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('imports data and runs migrations', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);
      mockAdapter.executeMany.mockClear();

      await importDatabase(new Uint8Array([1, 2, 3]));

      expect(mockAdapter.importDatabase).toHaveBeenCalledWith(
        new Uint8Array([1, 2, 3]),
        undefined
      );
      // Should run migrations after import
      expect(mockAdapter.executeMany).toHaveBeenCalled();
    });

    it('throws if import not supported', async () => {
      await setupDatabase('password', TEST_INSTANCE_ID);

      // Temporarily remove importDatabase
      const originalImport = mockAdapter.importDatabase;
      mockAdapter.importDatabase = undefined;

      await expect(importDatabase(new Uint8Array([1, 2, 3]))).rejects.toThrow(
        'Import not supported on this platform'
      );

      mockAdapter.importDatabase = originalImport;
    });
  });
});
