/**
 * Database reset stress test - performs multiple reset-setup cycles
 * Ported from: .maestro/database-reset-stress.yaml
 *
 * This tests edge cases in encryption secret handling by performing
 * rapid reset-setup cycles with different passwords.
 */

import { launchAppWithClearState } from '../helpers/app-lifecycle.js';
import { waitForWebView } from '../helpers/webview-helpers.js';
import { debugPage } from '../page-objects/debug.page.js';
import { goToDebug } from '../page-objects/navigation.js';

const NUM_CYCLES = 3; // Reduced for faster testing

// Fixed: resetDatabase() now uses connection.delete() instead of CapacitorSQLite.deleteDatabase()
// See: https://github.com/capacitor-community/sqlite/issues/272
describe('Database Reset Stress Test', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();
  });

  it(`should handle ${NUM_CYCLES} reset-setup cycles`, async () => {
    await goToDebug();
    await debugPage.waitForPageLoad();

    // Initial reset to clean state (only if needed)
    const currentStatus = await debugPage.getStatus();
    if (currentStatus !== 'Not Set Up') {
      await debugPage.clickReset();
      await browser.pause(1000);
      await debugPage.waitForStatus('Not Set Up');
    }

    for (let i = 1; i <= NUM_CYCLES; i++) {
      const password = `stress-test-password-${i}`;

      // Setup with unique password
      await debugPage.setPassword(password);
      await debugPage.clickSetup();
      await debugPage.waitForSuccess();
      await debugPage.waitForStatus('Unlocked');

      // Write data to verify database is working
      await debugPage.clickWriteData();
      await debugPage.waitForSuccess('Wrote test data:');

      // Read data to verify
      await debugPage.clickReadData();
      await debugPage.waitForSuccess('Read test data:');

      // Reset for next cycle (except on last iteration)
      if (i < NUM_CYCLES) {
        await debugPage.clickReset();
        // Wait for reset to complete (React state needs time to update)
        await browser.pause(1000);
        await debugPage.waitForStatus('Not Set Up');
        // Clear password field for next cycle
        await debugPage.clearPassword();
        await browser.pause(300);
      }
    }

    // Final verification - database should be unlocked
    const finalStatus = await debugPage.getStatus();
    expect(finalStatus).toBe('Unlocked');
  });

  after(async () => {
    // Cleanup
    try {
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
