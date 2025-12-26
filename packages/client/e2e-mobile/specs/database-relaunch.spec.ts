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

// TODO: App restart with Appium requires session termination/recreation
// which needs more work to handle properly
describe.skip('Database Relaunch Persistence', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();
  });

  it('should persist database state across app restart', async () => {
    // Navigate to debug page
    await goToDebug();
    await debugPage.waitForPageLoad();

    // The app should start fresh after launchAppWithClearState
    // Just setup the database
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
    // Cleanup - don't rely on reset which has known issues
    // The next test's launchAppWithClearState will handle cleanup
  });
});
