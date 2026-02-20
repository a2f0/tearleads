/**
 * Unit tests for user-settings guards, constants, and localStorage helpers.
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

import {
  getSettingFromStorage,
  isBorderRadiusValue,
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
  setSettingInStorage
} from '@tearleads/settings';

describe('user-settings guards and local storage', () => {
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
        expect(isLanguageValue('pt')).toBe(true);
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
      expect(SETTING_DEFAULTS.theme).toBe('light');
      expect(SETTING_DEFAULTS.language).toBe('en');
      expect(SETTING_DEFAULTS.tooltips).toBe('enabled');
      expect(SETTING_DEFAULTS.font).toBe('system');
      expect(SETTING_DEFAULTS.desktopPattern).toBe('isometric');
      expect(SETTING_DEFAULTS.desktopIconDepth).toBe('debossed');
      expect(SETTING_DEFAULTS.desktopIconBackground).toBe('colored');
      expect(SETTING_DEFAULTS.windowOpacity).toBe('opaque');
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

      expect(() => setSettingInStorage('theme', 'dark')).not.toThrow();

      (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, value: string) => {
          localStorageData[key] = value;
        }
      );
    });
  });
});
