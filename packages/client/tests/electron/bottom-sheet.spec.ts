import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, launchElectronApp } from './electron-test-helper';

const APP_LOAD_TIMEOUT = 10000;

test.describe('Settings Window (Electron)', () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    page = await electronApp.firstWindow();
    await page.bringToFront();

    // Wait for app to load - verify Start button is visible
    const startButton = page.getByTestId('start-button');
    await expect(startButton).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Resize to a mobile-like viewport so settings uses the bottom sheet.
    await page.setViewportSize({ width: 600, height: 900 });

    await page.waitForFunction(() => window.innerWidth < 1024);
    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('settings-sheet-content')).toBeVisible();
  });

  test.afterEach(async () => {
    await closeElectronApp(electronApp);
  });

  test('opens settings window from header button', async () => {
    await expect(page.getByTestId('settings-sheet-content')).toBeVisible();
  });

  test('closes settings window from title bar control', async () => {
    await page.getByTestId('settings-sheet-backdrop').click();
    await expect(page.getByTestId('settings-sheet-content')).toBeHidden();
  });
});
