import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp } from './electron-test-helper';

const APP_LOAD_TIMEOUT = 10000;

test.describe('Settings Window (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();
    await window.bringToFront();

    // Wait for app to load - verify Start button is visible
    const startButton = window.getByTestId('start-button');
    await expect(startButton).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Resize to a mobile-like viewport so settings uses the bottom sheet.
    await window.setViewportSize({ width: 600, height: 900 });

    // Open the settings sheet
    await window.getByTestId('settings-button').click();
    await expect(
      window.locator('[data-testid^="floating-window-settings-"][role="dialog"]')
    ).toBeVisible();
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('opens settings window from header button', async () => {
    await expect(
      window.locator('[data-testid^="floating-window-settings-"][role="dialog"]')
    ).toBeVisible();
  });

  test('closes settings window from title bar control', async () => {
    await window.getByRole('button', { name: 'Close Settings' }).click();
    await expect(
      window.locator('[data-testid^="floating-window-settings-"][role="dialog"]')
    ).toBeHidden();
  });
});
