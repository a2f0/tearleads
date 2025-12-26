/**
 * Database operations test - tests SQLite database operations
 * Ported from: .maestro/database-test.yaml
 *
 * Note: Tests run sequentially and build on each other's state.
 * The flow is: Not Set Up -> Setup -> Unlocked -> Operations -> Lock -> Unlock
 */

import { launchAppWithClearState } from '../helpers/app-lifecycle.js';
import { waitForWebView } from '../helpers/webview-helpers.js';
import { debugPage } from '../page-objects/debug.page.js';
import { goToDebug } from '../page-objects/navigation.js';

const TEST_PASSWORD = 'testpassword123';

describe('Database Operations', () => {
  before(async () => {
    // Start with completely clean state
    await launchAppWithClearState();
    await waitForWebView();
    await goToDebug();
    await debugPage.waitForPageLoad();
  });

  describe('Password visibility toggle', () => {
    it('should hide password by default', async () => {
      const isVisible = await debugPage.isPasswordVisible();
      expect(isVisible).toBe(false);
    });

    it('should show password when eye icon is clicked', async () => {
      await debugPage.setPassword(TEST_PASSWORD);

      // Initially hidden
      expect(await debugPage.isPasswordVisible()).toBe(false);

      // Click to show
      await debugPage.togglePasswordVisibility();
      expect(await debugPage.isPasswordVisible()).toBe(true);

      // Click to hide again
      await debugPage.togglePasswordVisibility();
      expect(await debugPage.isPasswordVisible()).toBe(false);
    });
  });

  describe('Database lifecycle', () => {
    // These tests run sequentially and depend on the previous test's state

    it('should start in Not Set Up state', async () => {
      const status = await debugPage.getStatus();
      expect(status).toBe('Not Set Up');
    });

    it('should setup database with password', async () => {
      await debugPage.setupDatabase(TEST_PASSWORD);
      const status = await debugPage.getStatus();
      expect(status).toBe('Unlocked');
    });

    it('should write data to database', async () => {
      const writtenValue = await debugPage.writeAndGetData();
      expect(writtenValue).toMatch(/^test-value-\d+$/);
    });

    it('should read data from database', async () => {
      const readValue = await debugPage.readAndGetData();
      expect(readValue).toMatch(/^test-value-\d+$/);
    });

    it('should lock database', async () => {
      await debugPage.lockDatabase();
      const status = await debugPage.getStatus();
      expect(status).toBe('Locked');
    });

    it('should fail unlock with wrong password', async () => {
      await debugPage.setPassword('wrongpassword');
      await debugPage.clickUnlock();

      // Verify error message appears
      await debugPage.waitForError('Wrong password');

      // Verify still locked
      const status = await debugPage.getStatus();
      expect(status).toBe('Locked');
    });

    it('should unlock with correct password', async () => {
      // Clear the wrong password first
      await debugPage.clearPassword();
      await browser.pause(300);

      await debugPage.setPassword(TEST_PASSWORD);
      await debugPage.clickUnlock();
      await debugPage.waitForStatus('Unlocked');

      const status = await debugPage.getStatus();
      expect(status).toBe('Unlocked');
    });

    it('should preserve data after lock/unlock cycle', async () => {
      const readValue = await debugPage.readAndGetData();
      expect(readValue).toMatch(/^test-value-\d+$/);
    });
  });

  after(async () => {
    // Best effort cleanup
    try {
      const currentStatus = await debugPage.getStatus();
      if (currentStatus !== 'Not Set Up') {
        await debugPage.clickReset();
        await browser.pause(500);
      }
    } catch {
      // Ignore cleanup errors
    }
  });
});
