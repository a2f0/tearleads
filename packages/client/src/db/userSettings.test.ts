/**
 * Unit tests for user-settings module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Store for mocked localStorage
let localStorageData: Record<string, string> = {};

// Mock localStorage before imports
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => localStorageData[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageData[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageData[key];
    }),
    clear: vi.fn(() => {
      localStorageData = {};
    })
  },
  writable: true
});

// Type for mock settings row
interface MockSettingsRow {
  key: string;
  value: string | null;
}

// Create mock for onConflictDoUpdate chain
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn(() => ({
  onConflictDoUpdate: mockOnConflictDoUpdate
}));
const mockInsert = vi.fn(() => ({
  values: mockValues
}));
const mockWhere = vi.fn((): Promise<MockSettingsRow[]> => Promise.resolve([]));
const mockFrom = vi.fn(() => ({
  where: mockWhere
}));
const mockSelect = vi.fn(() => ({
  from: mockFrom
}));

// Create mock database
const mockDb = {
  insert: mockInsert,
  select: mockSelect
} as unknown as import('./index').Database;

// Import after mocks
import { dispatchSettingsSyncedEvent } from '@tearleads/settings';
import { getSettingsFromDb, saveSettingToDb } from './userSettings';

describe('user-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageData = {};
  });

  describe('getSettingsFromDb', () => {
    it('returns empty object when no settings in db', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getSettingsFromDb(mockDb);

      expect(result).toEqual({});
    });

    it('returns theme from database', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'theme', value: 'dark' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.theme).toBe('dark');
    });

    it('returns language from database', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'language', value: 'es' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.language).toBe('es');
    });

    it('returns tooltips from database', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'tooltips', value: 'disabled' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.tooltips).toBe('disabled');
    });

    it('returns font from database', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'font', value: 'monospace' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.font).toBe('monospace');
    });

    it('returns desktopPattern from database', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'desktopPattern', value: 'diamonds' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.desktopPattern).toBe('diamonds');
    });

    it('returns desktopIconDepth from database', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'desktopIconDepth', value: 'debossed' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.desktopIconDepth).toBe('debossed');
    });

    it('returns desktopIconBackground from database', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'desktopIconBackground', value: 'transparent' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.desktopIconBackground).toBe('transparent');
    });

    it('returns windowOpacity from database', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'windowOpacity', value: 'opaque' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.windowOpacity).toBe('opaque');
    });

    it('returns borderRadius from database', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'borderRadius', value: 'square' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.borderRadius).toBe('square');
    });

    it('returns both theme and language from database', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'theme', value: 'tokyo-night' },
        { key: 'language', value: 'ua' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result).toEqual({
        theme: 'tokyo-night',
        language: 'ua'
      });
    });

    it('ignores null values', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'theme', value: null },
        { key: 'language', value: null }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result).toEqual({});
    });

    it('ignores invalid theme values', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'theme', value: 'invalid' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.theme).toBeUndefined();
    });

    it('ignores invalid language values', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'language', value: 'fr' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.language).toBeUndefined();
    });

    it('ignores invalid tooltips values', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'tooltips', value: 'true' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.tooltips).toBeUndefined();
    });

    it('ignores invalid desktopPattern values', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'desktopPattern', value: 'grid' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.desktopPattern).toBeUndefined();
    });

    it('ignores invalid desktopIconDepth values', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'desktopIconDepth', value: 'raised' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.desktopIconDepth).toBeUndefined();
    });

    it('ignores invalid desktopIconBackground values', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'desktopIconBackground', value: 'opaque' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.desktopIconBackground).toBeUndefined();
    });

    it('ignores invalid font values', async () => {
      mockWhere.mockResolvedValueOnce([{ key: 'font', value: 'serif' }]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.font).toBeUndefined();
    });

    it('ignores invalid windowOpacity values', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'windowOpacity', value: 'invalid' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.windowOpacity).toBeUndefined();
    });

    it('ignores invalid borderRadius values', async () => {
      mockWhere.mockResolvedValueOnce([
        { key: 'borderRadius', value: 'invalid' }
      ]);

      const result = await getSettingsFromDb(mockDb);

      expect(result.borderRadius).toBeUndefined();
    });
  });

  describe('saveSettingToDb', () => {
    it('inserts theme with correct values', async () => {
      await saveSettingToDb(mockDb, 'theme', 'dark');

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'theme',
          value: 'dark'
        })
      );
    });

    it('inserts language with correct values', async () => {
      await saveSettingToDb(mockDb, 'language', 'es');

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'language',
          value: 'es'
        })
      );
    });

    it('inserts tooltips with correct values', async () => {
      await saveSettingToDb(mockDb, 'tooltips', 'disabled');

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'tooltips',
          value: 'disabled'
        })
      );
    });

    it('inserts borderRadius with correct values', async () => {
      await saveSettingToDb(mockDb, 'borderRadius', 'square');

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'borderRadius',
          value: 'square'
        })
      );
    });

    it('uses onConflictDoUpdate for upsert', async () => {
      await saveSettingToDb(mockDb, 'theme', 'tokyo-night');

      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({
            value: 'tokyo-night'
          })
        })
      );
    });

    it('sets updatedAt timestamp', async () => {
      const before = new Date();
      await saveSettingToDb(mockDb, 'theme', 'light');
      const after = new Date();

      expect(mockValues).toHaveBeenCalled();
      const calls = mockValues.mock.calls as unknown[][];
      const call = calls[0]?.[0] as { updatedAt: Date };
      expect(call.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(call.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('dispatchSettingsSyncedEvent', () => {
    it('dispatches custom event with settings', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      dispatchSettingsSyncedEvent({ theme: 'dark', language: 'es' });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'settings-synced',
          detail: {
            settings: { theme: 'dark', language: 'es' }
          }
        })
      );

      dispatchSpy.mockRestore();
    });

    it('dispatches event with partial settings', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      dispatchSettingsSyncedEvent({ theme: 'light' });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            settings: { theme: 'light' }
          }
        })
      );

      dispatchSpy.mockRestore();
    });

    it('dispatches event with empty settings', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      dispatchSettingsSyncedEvent({});

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            settings: {}
          }
        })
      );

      dispatchSpy.mockRestore();
    });
  });
});
