/**
 * Integration tests for user-settings database operations.
 *
 * Tests getSettingsFromDb and saveSettingToDb with a real SQLite database,
 * verifying actual database state rather than mock calls.
 */

import { userSettings } from '@tearleads/db/sqlite';
import {
  commonTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, type vi } from 'vitest';
import { mockConsoleWarn } from '../test/console-mocks';
import { getSettingsFromDb, saveSettingToDb } from './user-settings';

describe('user-settings integration', () => {
  // Mock console.warn to allow expected OPFS warning on WASM initialization
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = mockConsoleWarn();
  });

  afterEach(() => {
    // Verify only expected warnings occurred
    const allowedWarnings = ['Ignoring inability to install OPFS sqlite3_vfs'];
    const unexpectedWarnings = warnSpy.mock.calls.filter((call: unknown[]) => {
      const message = typeof call[0] === 'string' ? call[0] : '';
      return !allowedWarnings.some((allowed) => message.includes(allowed));
    });
    expect(unexpectedWarnings).toEqual([]);
    warnSpy.mockRestore();
  });

  describe('saveSettingToDb', () => {
    it('inserts a new setting into the database', async () => {
      await withRealDatabase(
        async ({ db }) => {
          // Act
          await saveSettingToDb(db, 'theme', 'dark');

          // Assert - verify actual database state
          const rows = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.key, 'theme'));

          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            key: 'theme',
            value: 'dark'
          });
          expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
        },
        { migrations: commonTestMigrations }
      );
    });

    it('updates existing setting on conflict', async () => {
      await withRealDatabase(
        async ({ db }) => {
          // Arrange - insert initial value
          await saveSettingToDb(db, 'theme', 'light');

          // Act - update to new value
          await saveSettingToDb(db, 'theme', 'tokyo-night');

          // Assert - should have only one row with updated value
          const rows = await db.select().from(userSettings);

          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            key: 'theme',
            value: 'tokyo-night'
          });
        },
        { migrations: commonTestMigrations }
      );
    });

    it('saves multiple different settings', async () => {
      await withRealDatabase(
        async ({ db }) => {
          // Act
          await saveSettingToDb(db, 'theme', 'dark');
          await saveSettingToDb(db, 'language', 'es');
          await saveSettingToDb(db, 'tooltips', 'disabled');

          // Assert
          const rows = await db.select().from(userSettings);

          expect(rows).toHaveLength(3);

          const themeRow = rows.find((r: { key: string }) => r.key === 'theme');
          const langRow = rows.find(
            (r: { key: string }) => r.key === 'language'
          );
          const tooltipsRow = rows.find(
            (r: { key: string }) => r.key === 'tooltips'
          );

          expect(themeRow?.value).toBe('dark');
          expect(langRow?.value).toBe('es');
          expect(tooltipsRow?.value).toBe('disabled');
        },
        { migrations: commonTestMigrations }
      );
    });
  });

  describe('getSettingsFromDb', () => {
    it('returns empty object when no settings exist', async () => {
      await withRealDatabase(
        async ({ db }) => {
          const result = await getSettingsFromDb(db);

          expect(result).toEqual({});
        },
        { migrations: commonTestMigrations }
      );
    });

    it('returns all saved settings', async () => {
      await withRealDatabase(
        async ({ db }) => {
          // Arrange - save some settings
          await saveSettingToDb(db, 'theme', 'tokyo-night');
          await saveSettingToDb(db, 'language', 'ua');
          await saveSettingToDb(db, 'font', 'monospace');

          // Act
          const result = await getSettingsFromDb(db);

          // Assert
          expect(result).toEqual({
            theme: 'tokyo-night',
            language: 'ua',
            font: 'monospace'
          });
        },
        { migrations: commonTestMigrations }
      );
    });

    it('ignores invalid values in database', async () => {
      await withRealDatabase(
        async ({ db }) => {
          // Arrange - insert invalid values directly
          await db.insert(userSettings).values([
            { key: 'theme', value: 'invalid-theme', updatedAt: new Date() },
            { key: 'language', value: 'fr', updatedAt: new Date() }, // Invalid language
            { key: 'font', value: 'monospace', updatedAt: new Date() } // Valid
          ]);

          // Act
          const result = await getSettingsFromDb(db);

          // Assert - only valid settings returned
          expect(result).toEqual({
            font: 'monospace'
          });
        },
        { migrations: commonTestMigrations }
      );
    });

    it('ignores null values', async () => {
      await withRealDatabase(
        async ({ db }) => {
          // Arrange - insert with null value
          await db.insert(userSettings).values([
            { key: 'theme', value: null, updatedAt: new Date() },
            { key: 'language', value: 'en', updatedAt: new Date() }
          ]);

          // Act
          const result = await getSettingsFromDb(db);

          // Assert
          expect(result).toEqual({
            language: 'en'
          });
        },
        { migrations: commonTestMigrations }
      );
    });
  });

  describe('round-trip: save and retrieve', () => {
    it('saves all setting types and retrieves them correctly', async () => {
      await withRealDatabase(
        async ({ db }) => {
          // Arrange - save all setting types
          await saveSettingToDb(db, 'theme', 'monochrome');
          await saveSettingToDb(db, 'language', 'en');
          await saveSettingToDb(db, 'tooltips', 'enabled');
          await saveSettingToDb(db, 'font', 'system');
          await saveSettingToDb(db, 'desktopPattern', 'honeycomb');
          await saveSettingToDb(db, 'desktopIconDepth', 'embossed');
          await saveSettingToDb(db, 'desktopIconBackground', 'transparent');
          await saveSettingToDb(db, 'borderRadius', 'square');

          // Act
          const result = await getSettingsFromDb(db);

          // Assert
          expect(result).toEqual({
            theme: 'monochrome',
            language: 'en',
            tooltips: 'enabled',
            font: 'system',
            desktopPattern: 'honeycomb',
            desktopIconDepth: 'embossed',
            desktopIconBackground: 'transparent',
            borderRadius: 'square'
          });
        },
        { migrations: commonTestMigrations }
      );
    });
  });
});
