/**
 * Database relaunch persistence test - tests data persistence across app restarts
 * Ported from: .maestro/database-relaunch.yaml
 */

import {
  launchAppWithClearState,
  restartApp,
} from '../helpers/app-lifecycle.js';
import { waitForWebView } from '../helpers/webview-helpers.js';
import { debugPage } from '../page-objects/debug.page.js';
import { goToDebug } from '../page-objects/navigation.js';

const TEST_PASSWORD = 'relaunchtest123';

// TODO: App restart persistence test needs work with Appium session handling
describe.skip('Database Relaunch Persistence', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();
  });

  it('should persist database state across app restart', async () => {
    // Navigate to debug page
    await goToDebug();
    await debugPage.waitForPageLoad();

    // Ensure clean state and setup
    const currentStatus = await debugPage.getStatus();
    if (currentStatus !== 'Not Set Up') {
      await debugPage.clickReset();
      await debugPage.waitForSuccess();
      await debugPage.waitForStatus('Not Set Up');
    }
    await debugPage.setupDatabase(TEST_PASSWORD);

    // Write data
    const writtenValue = await debugPage.writeAndGetData();
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    // Lock before restart
    await debugPage.lockDatabase();

    // Restart app WITHOUT clearing state
    await restartApp(false);
    await waitForWebView();

    // Navigate back to debug page
    await goToDebug();
    await debugPage.waitForPageLoad();

    // Should show as Locked (persisted)
    await debugPage.waitForStatus('Locked');

    // Unlock with same password
    await debugPage.unlockDatabase(TEST_PASSWORD);

    // Read data - should persist
    const readValue = await debugPage.readAndGetData();
    expect(readValue).toBe(writtenValue);
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
