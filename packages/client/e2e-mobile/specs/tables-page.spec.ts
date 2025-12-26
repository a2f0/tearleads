/**
 * Tables page test - tests SQLite table viewer
 * Ported from: .maestro/tables-page.yaml
 */

import { launchAppWithClearState } from '../helpers/app-lifecycle.js';
import { waitForWebView } from '../helpers/webview-helpers.js';
import { debugPage } from '../page-objects/debug.page.js';
import { tablesPage } from '../page-objects/tables.page.js';
import { goToDebug, goToTables } from '../page-objects/navigation.js';

const TEST_PASSWORD = 'tablestest123';

describe('Tables Page', () => {
  before(async () => {
    // launchAppWithClearState ensures clean slate - no reset needed
    await launchAppWithClearState();
    await waitForWebView();
  });

  describe('when database is locked', () => {
    before(async () => {
      // Setup and lock database
      await goToDebug();
      await debugPage.waitForPageLoad();
      await debugPage.waitForStatus('Not Set Up');

      await debugPage.setupDatabase(TEST_PASSWORD);
      await debugPage.lockDatabase();
    });

    it('should show locked message', async () => {
      await goToTables();
      await tablesPage.waitForPageLoad();

      const isLocked = await tablesPage.isLockedMessageDisplayed();
      expect(isLocked).toBe(true);
    });
  });

  describe('when database is unlocked', () => {
    before(async () => {
      // Unlock database - wait for locked state first
      await goToDebug();
      await debugPage.waitForPageLoad();
      await debugPage.waitForStatus('Locked');

      // Clear password, enter correct one, and unlock
      // Need longer pauses to ensure UI is stable
      await debugPage.clearPassword();
      await browser.pause(500);
      await debugPage.setPassword(TEST_PASSWORD);
      await browser.pause(500);
      await debugPage.clickUnlock();

      // Wait for unlocked status with longer timeout
      await debugPage.waitForStatus('Unlocked', 15000);
    });

    it('should display SQLite tables', async () => {
      await goToTables();
      await tablesPage.waitForPageLoad();
      await tablesPage.waitForTables();

      // Should not show locked message
      const isLocked = await tablesPage.isLockedMessageDisplayed();
      expect(isLocked).toBe(false);
    });

    it('should show user_settings table', async () => {
      const hasTable = await tablesPage.hasUserSettingsTable();
      expect(hasTable).toBe(true);
    });

    it('should show schema_migrations table', async () => {
      const hasTable = await tablesPage.hasSchemaMigrationsTable();
      expect(hasTable).toBe(true);
    });
  });

  after(async () => {
    // Cleanup - the next test's launchAppWithClearState will handle cleanup
    // No need to call reset which has known issues
  });
});
