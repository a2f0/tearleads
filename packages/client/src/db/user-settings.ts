/**
 * Strongly typed user settings definitions with localStorage/SQLite sync.
 *
 * This file defines all known user settings keys, their types, defaults,
 * and provides CRUD functions for both localStorage and database storage.
 */

import { inArray } from 'drizzle-orm';
import type { Database } from './index';
import { userSettings } from './schema';

// All known settings keys (stored in DB as key column)
export type UserSettingKey = 'theme' | 'language' | 'tooltips' | 'font';

// Per-setting value types
export type ThemeValue = 'light' | 'dark' | 'tokyo-night' | 'system';
export type LanguageValue = 'en' | 'es' | 'ua';
export type TooltipsValue = 'enabled' | 'disabled';
export type FontValue = 'system' | 'monospace';

// Map settings keys to their value types
export interface SettingValueMap {
  theme: ThemeValue;
  language: LanguageValue;
  tooltips: TooltipsValue;
  font: FontValue;
}

// Default values for each setting
export const SETTING_DEFAULTS: { [K in UserSettingKey]: SettingValueMap[K] } = {
  theme: 'system',
  language: 'en',
  tooltips: 'enabled',
  font: 'system'
};

// localStorage keys for each setting (maps our keys to existing localStorage keys)
export const SETTING_STORAGE_KEYS: Record<UserSettingKey, string> = {
  theme: 'theme',
  language: 'i18nextLng',
  tooltips: 'tooltips',
  font: 'font'
};

// Type guard functions
export function isThemeValue(value: string): value is ThemeValue {
  return ['light', 'dark', 'tokyo-night', 'system'].includes(value);
}

export function isLanguageValue(value: string): value is LanguageValue {
  return ['en', 'es', 'ua'].includes(value);
}

export function isTooltipsValue(value: string): value is TooltipsValue {
  return ['enabled', 'disabled'].includes(value);
}

export function isFontValue(value: string): value is FontValue {
  return ['system', 'monospace'].includes(value);
}

// Settings sync event detail type
export interface SettingsSyncedDetail {
  settings: Partial<{ [K in UserSettingKey]: SettingValueMap[K] }>;
}

/**
 * Get a setting value from localStorage.
 */
export function getSettingFromStorage<K extends UserSettingKey>(
  key: K
): SettingValueMap[K] | null {
  try {
    const value = localStorage.getItem(SETTING_STORAGE_KEYS[key]);
    if (value === null) return null;

    // Validate the value matches expected type
    if (key === 'theme' && isThemeValue(value)) {
      return value as SettingValueMap[K];
    }
    if (key === 'language' && isLanguageValue(value)) {
      return value as SettingValueMap[K];
    }
    if (key === 'tooltips' && isTooltipsValue(value)) {
      return value as SettingValueMap[K];
    }
    if (key === 'font' && isFontValue(value)) {
      return value as SettingValueMap[K];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Set a setting value in localStorage.
 */
export function setSettingInStorage<K extends UserSettingKey>(
  key: K,
  value: SettingValueMap[K]
): void {
  try {
    localStorage.setItem(SETTING_STORAGE_KEYS[key], value);
  } catch {
    // localStorage may not be available
  }
}

/**
 * Get all settings from database.
 */
export async function getSettingsFromDb(
  db: Database
): Promise<Partial<{ [K in UserSettingKey]: SettingValueMap[K] }>> {
  const allRows = await db
    .select()
    .from(userSettings)
    .where(
      inArray(
        userSettings.key,
        Object.keys(SETTING_DEFAULTS) as UserSettingKey[]
      )
    );

  const settings: Partial<{ [K in UserSettingKey]: SettingValueMap[K] }> = {};

  for (const row of allRows) {
    const { key, value } = row;
    if (value === null) continue;

    if (key === 'theme' && isThemeValue(value)) {
      settings.theme = value;
    } else if (key === 'language' && isLanguageValue(value)) {
      settings.language = value;
    } else if (key === 'tooltips' && isTooltipsValue(value)) {
      settings.tooltips = value;
    } else if (key === 'font' && isFontValue(value)) {
      settings.font = value;
    }
  }

  return settings;
}

/**
 * Save a setting to database.
 */
export async function saveSettingToDb<K extends UserSettingKey>(
  db: Database,
  key: K,
  value: SettingValueMap[K]
): Promise<void> {
  const now = new Date();
  await db
    .insert(userSettings)
    .values({
      key,
      value,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: userSettings.key,
      set: { value, updatedAt: now }
    });
}

/**
 * Dispatch settings-synced custom event for ThemeProvider and i18n to react.
 */
export function dispatchSettingsSyncedEvent(
  settings: Partial<{ [K in UserSettingKey]: SettingValueMap[K] }>
): void {
  const event = new CustomEvent<SettingsSyncedDetail>('settings-synced', {
    detail: { settings }
  });
  window.dispatchEvent(event);
}
