/**
 * Unit tests for instance-scoped user-settings functions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Store for mocked localStorage
let localStorageData: Record<string, string> = {};

// Implementation functions for mock restoration
const getItemImpl = (key: string) => localStorageData[key] ?? null;
const setItemImpl = (key: string, value: string) => {
  localStorageData[key] = value;
};
const removeItemImpl = (key: string) => {
  delete localStorageData[key];
};
const clearImpl = () => {
  localStorageData = {};
};
const keyImpl = (i: number) => Object.keys(localStorageData)[i] ?? null;

// Mock localStorage before imports
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(getItemImpl),
    setItem: vi.fn(setItemImpl),
    removeItem: vi.fn(removeItemImpl),
    clear: vi.fn(clearImpl),
    key: vi.fn(keyImpl),
    get length() {
      return Object.keys(localStorageData).length;
    }
  },
  writable: true
});

// Import after mocks
import {
  clearInstanceSettings,
  getSettingFromStorage,
  migrateUnscopedSettings,
  resolveStorageKey,
  setSettingInStorage
} from './userSettings.js';

describe('instance-scoped user-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageData = {};
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
      getItemImpl
    );
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(
      setItemImpl
    );
  });

  describe('resolveStorageKey', () => {
    it('returns base key when no instanceId', () => {
      expect(resolveStorageKey('theme')).toBe('theme');
      expect(resolveStorageKey('language')).toBe('i18nextLng');
    });

    it('returns base key when instanceId is null', () => {
      expect(resolveStorageKey('theme', null)).toBe('theme');
    });

    it('returns scoped key when instanceId is provided', () => {
      expect(resolveStorageKey('theme', 'inst-1')).toBe(
        'setting:inst-1:theme'
      );
      expect(resolveStorageKey('language', 'inst-1')).toBe(
        'setting:inst-1:i18nextLng'
      );
    });
  });

  describe('instance-scoped getSettingFromStorage', () => {
    it('reads from scoped key when instanceId provided', () => {
      localStorageData['setting:inst-1:theme'] = 'dark';
      expect(getSettingFromStorage('theme', 'inst-1')).toBe('dark');
    });

    it('does not read unscoped key when instanceId provided', () => {
      localStorageData['theme'] = 'dark';
      expect(getSettingFromStorage('theme', 'inst-1')).toBeNull();
    });

    it('reads unscoped key when no instanceId', () => {
      localStorageData['theme'] = 'dark';
      expect(getSettingFromStorage('theme')).toBe('dark');
    });
  });

  describe('instance-scoped setSettingInStorage', () => {
    it('writes to scoped key when instanceId provided', () => {
      setSettingInStorage('theme', 'dark', 'inst-1');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'setting:inst-1:theme',
        'dark'
      );
    });

    it('writes to unscoped key when no instanceId', () => {
      setSettingInStorage('theme', 'dark');
      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
    });
  });

  describe('clearInstanceSettings', () => {
    it('removes all scoped keys for an instance', () => {
      localStorageData['setting:inst-1:theme'] = 'dark';
      localStorageData['setting:inst-1:i18nextLng'] = 'es';
      localStorageData['setting:inst-2:theme'] = 'light';
      localStorageData['unrelated'] = 'value';

      clearInstanceSettings('inst-1');

      expect(localStorage.removeItem).toHaveBeenCalledWith(
        'setting:inst-1:theme'
      );
      expect(localStorage.removeItem).toHaveBeenCalledWith(
        'setting:inst-1:i18nextLng'
      );
      expect(localStorage.removeItem).not.toHaveBeenCalledWith(
        'setting:inst-2:theme'
      );
      expect(localStorage.removeItem).not.toHaveBeenCalledWith('unrelated');
    });
  });

  describe('migrateUnscopedSettings', () => {
    it('copies unscoped values to scoped keys', () => {
      localStorageData['theme'] = 'dark';
      localStorageData['i18nextLng'] = 'es';

      migrateUnscopedSettings('inst-1');

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'setting:inst-1:theme',
        'dark'
      );
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'setting:inst-1:i18nextLng',
        'es'
      );
    });

    it('does not overwrite existing scoped keys', () => {
      localStorageData['theme'] = 'dark';
      localStorageData['setting:inst-1:theme'] = 'light';

      migrateUnscopedSettings('inst-1');

      expect(localStorage.setItem).not.toHaveBeenCalledWith(
        'setting:inst-1:theme',
        'dark'
      );
    });

    it('skips settings with no unscoped value', () => {
      migrateUnscopedSettings('inst-1');

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });
  });
});
