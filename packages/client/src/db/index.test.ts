/**
 * Unit tests for database API.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the adapters module
const mockAdapter = {
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
const mockKeyManager = {
  hasExistingKey: vi.fn(async () => false),
  setupNewKey: vi.fn(async () => new Uint8Array(32)),
  unlockWithPassword: vi.fn(
    async () => new Uint8Array(32) as Uint8Array | null
  ),
  changePassword: vi.fn(
    async () =>
      ({
        oldKey: new Uint8Array(32),
        newKey: new Uint8Array(32)
      }) as { oldKey: Uint8Array; newKey: Uint8Array } | null
  ),
  getCurrentKey: vi.fn(() => null),
  clearKey: vi.fn(),
  reset: vi.fn(),
  persistSession: vi.fn(async () => true),
  hasPersistedSession: vi.fn(async () => false),
  restoreSession: vi.fn(async () => null),
  clearPersistedSession: vi.fn()
};

vi.mock('./crypto', () => ({
  getKeyManager: vi.fn(() => mockKeyManager)
}));

// Import after mocks are set up
import {
  changePassword,
  closeDatabase,
  exportDatabase,
  getCurrentPlatform,
  getDatabase,
  getDatabaseAdapter,
  importDatabase,
  isDatabaseSetUp,
  resetDatabase,
  setupDatabase,
  unlockDatabase
} from './index';

describe('Database API', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the module state by re-importing
    // Since we can't easily reset module state, we'll reset via resetDatabase
    try {
      await resetDatabase();
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
      const result = await isDatabaseSetUp();
      expect(result).toBe(false);
    });

    it('returns true when key exists', async () => {
      mockKeyManager.hasExistingKey.mockResolvedValueOnce(true);
      const result = await isDatabaseSetUp();
      expect(result).toBe(true);
    });
  });

  describe('setupDatabase', () => {
    it('creates encryption key and initializes database', async () => {
      const db = await setupDatabase('password123');

      expect(mockKeyManager.setupNewKey).toHaveBeenCalledWith('password123');
      expect(mockAdapter.initialize).toHaveBeenCalled();
      expect(db).toBeDefined();
    });

    it('runs migrations after initialization', async () => {
      await setupDatabase('password123');
      expect(mockAdapter.executeMany).toHaveBeenCalled();
    });

    it('throws if database already initialized', async () => {
      await setupDatabase('password123');
      await expect(setupDatabase('password123')).rejects.toThrow(
        'Database already initialized'
      );
    });
  });

  describe('unlockDatabase', () => {
    it('returns null for wrong password', async () => {
      mockKeyManager.unlockWithPassword.mockResolvedValueOnce(null);
      const result = await unlockDatabase('wrongpassword');
      expect(result).toBeNull();
    });

    it('initializes database with correct password', async () => {
      const result = await unlockDatabase('correctpassword');

      expect(mockKeyManager.unlockWithPassword).toHaveBeenCalledWith(
        'correctpassword'
      );
      expect(mockAdapter.initialize).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.db).toBeDefined();
      expect(result?.sessionPersisted).toBe(false);
    });

    it('returns existing database if already unlocked', async () => {
      const result1 = await unlockDatabase('password');
      const result2 = await unlockDatabase('password');

      expect(result1?.db).toBe(result2?.db);
      // Should only initialize once
      expect(mockAdapter.initialize).toHaveBeenCalledTimes(1);
    });

    it('returns sessionPersisted true when persist succeeds', async () => {
      mockKeyManager.persistSession.mockResolvedValueOnce(true);
      const result = await unlockDatabase('password', true);

      expect(result?.sessionPersisted).toBe(true);
      expect(mockKeyManager.persistSession).toHaveBeenCalled();
    });

    it('returns sessionPersisted false when persist fails', async () => {
      mockKeyManager.persistSession.mockResolvedValueOnce(false);
      const result = await unlockDatabase('password', true);

      expect(result?.sessionPersisted).toBe(false);
    });
  });

  describe('getDatabase', () => {
    it('throws if database not initialized', async () => {
      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('returns database instance after setup', async () => {
      await setupDatabase('password');
      const db = getDatabase();
      expect(db).toBeDefined();
    });
  });

  describe('getDatabaseAdapter', () => {
    it('throws if database not initialized', async () => {
      expect(() => getDatabaseAdapter()).toThrow('Database not initialized');
    });

    it('returns adapter after setup', async () => {
      await setupDatabase('password');
      const adapter = getDatabaseAdapter();
      expect(adapter).toBeDefined();
    });
  });

  describe('closeDatabase', () => {
    it('closes the adapter', async () => {
      await setupDatabase('password');
      await closeDatabase();

      expect(mockAdapter.close).toHaveBeenCalled();
      expect(mockKeyManager.clearKey).toHaveBeenCalled();
    });

    it('clears the database instance', async () => {
      await setupDatabase('password');
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
      await setupDatabase('password');
      mockKeyManager.changePassword.mockResolvedValueOnce(null);

      const result = await changePassword('wrongpassword', 'newpassword');
      expect(result).toBe(false);
    });

    it('rekeys database on successful password change', async () => {
      await setupDatabase('password');

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
      await setupDatabase('password');
      await resetDatabase();

      expect(mockAdapter.close).toHaveBeenCalled();
      expect(mockAdapter.deleteDatabase).toHaveBeenCalledWith('rapid');
      expect(mockKeyManager.reset).toHaveBeenCalled();
    });

    it('terminates worker on web platform', async () => {
      await setupDatabase('password');
      await resetDatabase();

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
      await setupDatabase('password');
      const data = await exportDatabase();

      expect(mockAdapter.exportDatabase).toHaveBeenCalled();
      expect(data).toBeInstanceOf(Uint8Array);
    });

    it('throws if export not supported', async () => {
      await setupDatabase('password');

      // Temporarily remove exportDatabase
      const originalExport = mockAdapter.exportDatabase;
      mockAdapter.exportDatabase =
        undefined as unknown as typeof originalExport;

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
      await setupDatabase('password');
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
      await setupDatabase('password');

      // Temporarily remove importDatabase
      const originalImport = mockAdapter.importDatabase;
      mockAdapter.importDatabase =
        undefined as unknown as typeof originalImport;

      await expect(importDatabase(new Uint8Array([1, 2, 3]))).rejects.toThrow(
        'Import not supported on this platform'
      );

      mockAdapter.importDatabase = originalImport;
    });
  });
});
