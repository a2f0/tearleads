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
import {
  dispatchSettingsSyncedEvent,
  isBorderRadiusValue,
  getSettingFromStorage,
  getSettingsFromDb,
  isDesktopIconBackgroundValue,
  isDesktopIconDepthValue,
  isDesktopPatternValue,
  isFontValue,
  isLanguageValue,
  isThemeValue,
  isTooltipsValue,
  isWindowOpacityValue,
  SETTING_DEFAULTS,
  SETTING_STORAGE_KEYS,
  saveSettingToDb,
  setSettingInStorage
} from './user-settings';

describe('user-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageData = {};
  });

  describe('type guards', () => {
    describe('isThemeValue', () => {
      it('returns true for valid theme values', () => {
        expect(isThemeValue('light')).toBe(true);
        expect(isThemeValue('dark')).toBe(true);
        expect(isThemeValue('tokyo-night')).toBe(true);
        expect(isThemeValue('monochrome')).toBe(true);
        expect(isThemeValue('system')).toBe(true);
      });

      it('returns false for invalid theme values', () => {
        expect(isThemeValue('invalid')).toBe(false);
        expect(isThemeValue('')).toBe(false);
        expect(isThemeValue('DARK')).toBe(false);
      });
    });

    describe('isLanguageValue', () => {
      it('returns true for valid language values', () => {
        expect(isLanguageValue('en')).toBe(true);
        expect(isLanguageValue('es')).toBe(true);
        expect(isLanguageValue('ua')).toBe(true);
      });

      it('returns false for invalid language values', () => {
        expect(isLanguageValue('fr')).toBe(false);
        expect(isLanguageValue('')).toBe(false);
        expect(isLanguageValue('EN')).toBe(false);
      });
    });

    describe('isTooltipsValue', () => {
      it('returns true for valid tooltips values', () => {
        expect(isTooltipsValue('enabled')).toBe(true);
        expect(isTooltipsValue('disabled')).toBe(true);
      });

      it('returns false for invalid tooltips values', () => {
        expect(isTooltipsValue('true')).toBe(false);
        expect(isTooltipsValue('false')).toBe(false);
        expect(isTooltipsValue('')).toBe(false);
        expect(isTooltipsValue('ENABLED')).toBe(false);
      });
    });

    describe('isFontValue', () => {
      it('returns true for valid font values', () => {
        expect(isFontValue('system')).toBe(true);
        expect(isFontValue('monospace')).toBe(true);
      });

      it('returns false for invalid font values', () => {
        expect(isFontValue('serif')).toBe(false);
        expect(isFontValue('')).toBe(false);
        expect(isFontValue('SYSTEM')).toBe(false);
      });
    });

    describe('isDesktopPatternValue', () => {
      it('returns true for valid desktop pattern values', () => {
        expect(isDesktopPatternValue('solid')).toBe(true);
        expect(isDesktopPatternValue('honeycomb')).toBe(true);
        expect(isDesktopPatternValue('isometric')).toBe(true);
        expect(isDesktopPatternValue('triangles')).toBe(true);
        expect(isDesktopPatternValue('diamonds')).toBe(true);
      });

      it('returns false for invalid desktop pattern values', () => {
        expect(isDesktopPatternValue('grid')).toBe(false);
        expect(isDesktopPatternValue('')).toBe(false);
        expect(isDesktopPatternValue('SOLID')).toBe(false);
      });
    });

    describe('isDesktopIconDepthValue', () => {
      it('returns true for valid desktop icon depth values', () => {
        expect(isDesktopIconDepthValue('embossed')).toBe(true);
        expect(isDesktopIconDepthValue('debossed')).toBe(true);
      });

      it('returns false for invalid desktop icon depth values', () => {
        expect(isDesktopIconDepthValue('raised')).toBe(false);
        expect(isDesktopIconDepthValue('')).toBe(false);
        expect(isDesktopIconDepthValue('EMBOSSED')).toBe(false);
      });
    });

    describe('isDesktopIconBackgroundValue', () => {
      it('returns true for valid desktop icon background values', () => {
        expect(isDesktopIconBackgroundValue('colored')).toBe(true);
        expect(isDesktopIconBackgroundValue('transparent')).toBe(true);
      });

      it('returns false for invalid desktop icon background values', () => {
        expect(isDesktopIconBackgroundValue('opaque')).toBe(false);
        expect(isDesktopIconBackgroundValue('')).toBe(false);
        expect(isDesktopIconBackgroundValue('COLORED')).toBe(false);
      });
    });

    describe('isWindowOpacityValue', () => {
      it('returns true for valid window opacity values', () => {
        expect(isWindowOpacityValue('translucent')).toBe(true);
        expect(isWindowOpacityValue('opaque')).toBe(true);
      });

      it('returns false for invalid window opacity values', () => {
        expect(isWindowOpacityValue('transparent')).toBe(false);
        expect(isWindowOpacityValue('')).toBe(false);
        expect(isWindowOpacityValue('OPAQUE')).toBe(false);
      });
    });

    describe('isBorderRadiusValue', () => {
      it('returns true for valid border radius values', () => {
        expect(isBorderRadiusValue('rounded')).toBe(true);
        expect(isBorderRadiusValue('square')).toBe(true);
      });

      it('returns false for invalid border radius values', () => {
        expect(isBorderRadiusValue('soft')).toBe(false);
        expect(isBorderRadiusValue('')).toBe(false);
        expect(isBorderRadiusValue('ROUNDED')).toBe(false);
      });
    });
  });

  describe('constants', () => {
    it('has correct default values', () => {
      expect(SETTING_DEFAULTS.theme).toBe('monochrome');
      expect(SETTING_DEFAULTS.language).toBe('en');
      expect(SETTING_DEFAULTS.tooltips).toBe('enabled');
      expect(SETTING_DEFAULTS.font).toBe('system');
      expect(SETTING_DEFAULTS.desktopPattern).toBe('isometric');
      expect(SETTING_DEFAULTS.desktopIconDepth).toBe('debossed');
      expect(SETTING_DEFAULTS.desktopIconBackground).toBe('colored');
      expect(SETTING_DEFAULTS.windowOpacity).toBe('translucent');
      expect(SETTING_DEFAULTS.borderRadius).toBe('rounded');
    });

    it('has correct storage keys', () => {
      expect(SETTING_STORAGE_KEYS.theme).toBe('theme');
      expect(SETTING_STORAGE_KEYS.language).toBe('i18nextLng');
      expect(SETTING_STORAGE_KEYS.tooltips).toBe('tooltips');
      expect(SETTING_STORAGE_KEYS.font).toBe('font');
      expect(SETTING_STORAGE_KEYS.desktopPattern).toBe('desktopPattern');
      expect(SETTING_STORAGE_KEYS.desktopIconDepth).toBe('desktopIconDepth');
      expect(SETTING_STORAGE_KEYS.desktopIconBackground).toBe(
        'desktopIconBackground'
      );
      expect(SETTING_STORAGE_KEYS.windowOpacity).toBe('windowOpacity');
      expect(SETTING_STORAGE_KEYS.borderRadius).toBe('borderRadius');
    });
  });

  describe('getSettingFromStorage', () => {
    it('returns null when key not in localStorage', () => {
      expect(getSettingFromStorage('theme')).toBeNull();
      expect(getSettingFromStorage('language')).toBeNull();
      expect(getSettingFromStorage('tooltips')).toBeNull();
      expect(getSettingFromStorage('font')).toBeNull();
      expect(getSettingFromStorage('desktopPattern')).toBeNull();
      expect(getSettingFromStorage('desktopIconDepth')).toBeNull();
      expect(getSettingFromStorage('desktopIconBackground')).toBeNull();
      expect(getSettingFromStorage('windowOpacity')).toBeNull();
      expect(getSettingFromStorage('borderRadius')).toBeNull();
    });

    it('returns theme value from localStorage', () => {
      localStorageData['theme'] = 'dark';
      expect(getSettingFromStorage('theme')).toBe('dark');
    });

    it('returns language value from localStorage', () => {
      localStorageData['i18nextLng'] = 'es';
      expect(getSettingFromStorage('language')).toBe('es');
    });

    it('returns tooltips value from localStorage', () => {
      localStorageData['tooltips'] = 'disabled';
      expect(getSettingFromStorage('tooltips')).toBe('disabled');
    });

    it('returns font value from localStorage', () => {
      localStorageData['font'] = 'monospace';
      expect(getSettingFromStorage('font')).toBe('monospace');
    });

    it('returns desktopPattern value from localStorage', () => {
      localStorageData['desktopPattern'] = 'triangles';
      expect(getSettingFromStorage('desktopPattern')).toBe('triangles');
    });

    it('returns desktopIconDepth value from localStorage', () => {
      localStorageData['desktopIconDepth'] = 'debossed';
      expect(getSettingFromStorage('desktopIconDepth')).toBe('debossed');
    });

    it('returns desktopIconBackground value from localStorage', () => {
      localStorageData['desktopIconBackground'] = 'transparent';
      expect(getSettingFromStorage('desktopIconBackground')).toBe(
        'transparent'
      );
    });

    it('returns windowOpacity value from localStorage', () => {
      localStorageData['windowOpacity'] = 'opaque';
      expect(getSettingFromStorage('windowOpacity')).toBe('opaque');
    });

    it('returns borderRadius value from localStorage', () => {
      localStorageData['borderRadius'] = 'square';
      expect(getSettingFromStorage('borderRadius')).toBe('square');
    });

    it('returns null for invalid theme value', () => {
      localStorageData['theme'] = 'invalid-theme';
      expect(getSettingFromStorage('theme')).toBeNull();
    });

    it('returns null for invalid language value', () => {
      localStorageData['i18nextLng'] = 'fr';
      expect(getSettingFromStorage('language')).toBeNull();
    });

    it('returns null for invalid tooltips value', () => {
      localStorageData['tooltips'] = 'true';
      expect(getSettingFromStorage('tooltips')).toBeNull();
    });

    it('returns null for invalid font value', () => {
      localStorageData['font'] = 'serif';
      expect(getSettingFromStorage('font')).toBeNull();
    });

    it('returns null for invalid desktopPattern value', () => {
      localStorageData['desktopPattern'] = 'grid';
      expect(getSettingFromStorage('desktopPattern')).toBeNull();
    });

    it('returns null for invalid desktopIconDepth value', () => {
      localStorageData['desktopIconDepth'] = 'raised';
      expect(getSettingFromStorage('desktopIconDepth')).toBeNull();
    });

    it('returns null for invalid desktopIconBackground value', () => {
      localStorageData['desktopIconBackground'] = 'opaque';
      expect(getSettingFromStorage('desktopIconBackground')).toBeNull();
    });

    it('returns null for invalid windowOpacity value', () => {
      localStorageData['windowOpacity'] = 'invalid';
      expect(getSettingFromStorage('windowOpacity')).toBeNull();
    });

    it('returns null for invalid borderRadius value', () => {
      localStorageData['borderRadius'] = 'invalid';
      expect(getSettingFromStorage('borderRadius')).toBeNull();
    });

    it('handles localStorage errors gracefully', () => {
      const originalGetItem = localStorage.getItem;
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error('localStorage error');
        }
      );

      expect(getSettingFromStorage('theme')).toBeNull();

      (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
        originalGetItem
      );
    });
  });

  describe('setSettingInStorage', () => {
    it('sets theme in localStorage', () => {
      setSettingInStorage('theme', 'tokyo-night');
      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'tokyo-night');
    });

    it('sets language in localStorage with correct key', () => {
      setSettingInStorage('language', 'ua');
      expect(localStorage.setItem).toHaveBeenCalledWith('i18nextLng', 'ua');
    });

    it('sets tooltips in localStorage', () => {
      setSettingInStorage('tooltips', 'disabled');
      expect(localStorage.setItem).toHaveBeenCalledWith('tooltips', 'disabled');
    });

    it('sets font in localStorage', () => {
      setSettingInStorage('font', 'monospace');
      expect(localStorage.setItem).toHaveBeenCalledWith('font', 'monospace');
    });

    it('sets desktopPattern in localStorage', () => {
      setSettingInStorage('desktopPattern', 'diamonds');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'desktopPattern',
        'diamonds'
      );
    });

    it('sets desktopIconDepth in localStorage', () => {
      setSettingInStorage('desktopIconDepth', 'debossed');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'desktopIconDepth',
        'debossed'
      );
    });

    it('sets desktopIconBackground in localStorage', () => {
      setSettingInStorage('desktopIconBackground', 'transparent');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'desktopIconBackground',
        'transparent'
      );
    });

    it('sets windowOpacity in localStorage', () => {
      setSettingInStorage('windowOpacity', 'opaque');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'windowOpacity',
        'opaque'
      );
    });

    it('sets borderRadius in localStorage', () => {
      setSettingInStorage('borderRadius', 'square');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'borderRadius',
        'square'
      );
    });

    it('handles localStorage errors gracefully', () => {
      (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error('localStorage error');
        }
      );

      // Should not throw
      expect(() => setSettingInStorage('theme', 'dark')).not.toThrow();

      // Restore the mock
      (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, value: string) => {
          localStorageData[key] = value;
        }
      );
    });
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
