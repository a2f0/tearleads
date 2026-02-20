/**
 * Database-specific user settings functions.
 */

import {
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
  type SettingValueMap,
  type UserSettingKey
} from '@tearleads/settings';
import { inArray } from 'drizzle-orm';
import type { Database } from './index';
import { runLocalWrite } from './localWrite';
import { userSettings } from './schema';

// Map of setting keys to their type guard validators
const SETTING_VALIDATORS: {
  [K in UserSettingKey]: (value: string) => value is SettingValueMap[K];
} = {
  theme: isThemeValue,
  language: isLanguageValue,
  tooltips: isTooltipsValue,
  font: isFontValue,
  desktopPattern: isDesktopPatternValue,
  desktopIconDepth: isDesktopIconDepthValue,
  desktopIconBackground: isDesktopIconBackgroundValue,
  windowOpacity: isWindowOpacityValue,
  borderRadius: isBorderRadiusValue
};

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
    const { key, value } = row as { key: UserSettingKey; value: string | null };
    if (value === null) continue;

    const validator = SETTING_VALIDATORS[key];
    if (validator(value)) {
      (settings as Record<UserSettingKey, string>)[key] = value;
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
  await runLocalWrite(async () => {
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
  });
}
