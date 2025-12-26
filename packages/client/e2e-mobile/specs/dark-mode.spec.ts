/**
 * Dark mode switcher test - tests theme switching
 * Ported from: .maestro/dark-mode-switcher.yaml
 */

import { launchAppWithClearState } from '../helpers/app-lifecycle.js';
import { waitForWebView } from '../helpers/webview-helpers.js';
import { settingsPage } from '../page-objects/settings.page.js';
import { goToSettings } from '../page-objects/navigation.js';

describe('Dark Mode Switcher', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();
  });

  beforeEach(async () => {
    await goToSettings();
    await settingsPage.waitForPageLoad();
  });

  it('should start in light mode', async () => {
    const isDark = await settingsPage.isDarkMode();
    expect(isDark).toBe(false);
  });

  it('should switch to dark mode when toggle is clicked', async () => {
    // Ensure we start in light mode
    await settingsPage.disableDarkMode();

    // Toggle to dark mode
    await settingsPage.toggleDarkMode();
    await browser.pause(500); // Wait for transition

    // Verify dark class is applied
    const isDark = await settingsPage.isDarkMode();
    expect(isDark).toBe(true);
  });

  it('should switch back to light mode', async () => {
    // Ensure we start in dark mode
    await settingsPage.enableDarkMode();

    // Toggle back to light mode
    await settingsPage.toggleDarkMode();
    await browser.pause(500); // Wait for transition

    // Verify dark class is removed
    const isDark = await settingsPage.isDarkMode();
    expect(isDark).toBe(false);
  });

  it('should persist dark mode state across navigation', async () => {
    // Enable dark mode
    await settingsPage.enableDarkMode();
    const initialDark = await settingsPage.isDarkMode();
    expect(initialDark).toBe(true);

    // Navigate away and back
    const { goToDebug } = await import('../page-objects/navigation.js');
    await goToDebug();
    await browser.pause(500);
    await goToSettings();
    await browser.pause(500);

    // Verify dark mode is still enabled
    const stillDark = await settingsPage.isDarkMode();
    expect(stillDark).toBe(true);
  });

  after(async () => {
    // Cleanup: disable dark mode
    try {
      await settingsPage.disableDarkMode();
    } catch {
      // Ignore cleanup errors
    }
  });
});
