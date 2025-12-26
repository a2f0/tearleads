/**
 * Settings page test - tests basic settings UI elements
 * Extracted from backup-restore.spec.ts to test functionality
 * that doesn't require native dialogs or database reset
 */

import { launchAppWithClearState } from '../helpers/app-lifecycle.js';
import { waitForWebView } from '../helpers/webview-helpers.js';
import { debugPage } from '../page-objects/debug.page.js';
import { settingsPage } from '../page-objects/settings.page.js';
import { goToDebug, goToSettings } from '../page-objects/navigation.js';

const TEST_PASSWORD = 'settings-test-123';

describe('Settings Page', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();

    // Setup database - starts fresh after launchAppWithClearState
    await goToDebug();
    await debugPage.waitForPageLoad();
    await debugPage.setupDatabase(TEST_PASSWORD);
  });

  it('should display restore dropzone', async () => {
    await goToSettings();
    await settingsPage.waitForPageLoad();

    const isDisplayed = await settingsPage.isRestoreDropzoneDisplayed();
    expect(isDisplayed).toBe(true);
  });

  it('should enable export button when database is unlocked', async () => {
    await goToSettings();
    await settingsPage.waitForPageLoad();

    const isEnabled = await settingsPage.isExportButtonEnabled();
    expect(isEnabled).toBe(true);
  });

  it('should have dark mode toggle', async () => {
    await goToSettings();
    await settingsPage.waitForPageLoad();

    // Just verify the toggle exists - dark-mode.spec.ts tests functionality
    const toggle = await $('[data-testid="dark-mode-switch"]');
    const exists = await toggle.isExisting();
    expect(exists).toBe(true);
  });
});
