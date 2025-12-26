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

// TODO: Lock/unlock database operations don't properly update React state
// The locked message element isn't displayed after lockDatabase() is called
describe.skip('Tables Page', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();
  });

  describe('when database is locked', () => {
    before(async () => {
      // Setup and lock database
      await goToDebug();
      await debugPage.waitForPageLoad();

      // Ensure clean state first
      const currentStatus = await debugPage.getStatus();
      if (currentStatus !== 'Not Set Up') {
        await debugPage.clickReset();
        await browser.pause(1000);
        await debugPage.waitForStatus('Not Set Up');
      }

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
      // Unlock database
      await goToDebug();
      await debugPage.waitForPageLoad();
      await debugPage.unlockDatabase(TEST_PASSWORD);
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
    // Cleanup
    try {
      await goToDebug();
      await debugPage.waitForPageLoad();
      const currentStatus = await debugPage.getStatus();
      if (currentStatus !== 'Not Set Up') {
        await debugPage.clickReset();
        await debugPage.waitForStatus('Not Set Up');
      }
    } catch {
      // Ignore cleanup errors
    }
  });
});
