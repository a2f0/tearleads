/**
 * Strongly typed user settings definitions with localStorage/SQLite sync.
 *
 * This file defines all known user settings keys, their types, defaults,
 * and provides CRUD functions for both localStorage and database storage.
 */

import { eq } from 'drizzle-orm';
import type { Database } from './index';
import { userSettings } from './schema';

// All known settings keys (stored in DB as key column)
export type UserSettingKey = 'theme' | 'language';

// Per-setting value types
export type ThemeValue = 'light' | 'dark' | 'tokyo-night' | 'system';
export type LanguageValue = 'en' | 'es' | 'ua';

// Map settings keys to their value types
export interface SettingValueMap {
  theme: ThemeValue;
  language: LanguageValue;
}

// Default values for each setting
export const SETTING_DEFAULTS: { [K in UserSettingKey]: SettingValueMap[K] } = {
  theme: 'system',
  language: 'en'
};

// localStorage keys for each setting (maps our keys to existing localStorage keys)
export const SETTING_STORAGE_KEYS: Record<UserSettingKey, string> = {
  theme: 'theme',
  language: 'i18nextLng'
};

// Type guard functions
export function isThemeValue(value: string): value is ThemeValue {
  return ['light', 'dark', 'tokyo-night', 'system'].includes(value);
}

export function isLanguageValue(value: string): value is LanguageValue {
  return ['en', 'es', 'ua'].includes(value);
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
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.key, 'theme'));

  // Also get language separately since Drizzle doesn't have an easy IN operator
  const langRows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.key, 'language'));

  const allRows = [...rows, ...langRows];

  const settings: Partial<{ [K in UserSettingKey]: SettingValueMap[K] }> = {};

  for (const row of allRows) {
    const { key, value } = row;
    if (value === null) continue;

    if (key === 'theme' && isThemeValue(value)) {
      settings.theme = value;
    } else if (key === 'language' && isLanguageValue(value)) {
      settings.language = value;
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
  await db
    .insert(userSettings)
    .values({
      key,
      value,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: userSettings.key,
      set: { value, updatedAt: new Date() }
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
