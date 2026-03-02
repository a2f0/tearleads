import {test, expect, ElectronApplication, Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {closeElectronApp, launchElectronApp} from './electronTestHelper';

const require = createRequire(import.meta.url);
const packageJson: { version: string } = require('../../package.json');

const APP_LOAD_TIMEOUT = 10000;
const DB_OPERATION_TIMEOUT = 15000;

/**
 * Navigate to a route in the Electron app using client-side routing.
 * Electron uses a custom protocol that doesn't have a fallback to index.html,
 * so we use History API to trigger React Router navigation.
 */
async function navigateToRoute(page: Page, path: string): Promise<void> {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.describe('Electron App', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();
    // Wait for app to load before running tests
    await expect(window.getByTestId('start-button')).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  });

  test.afterEach(async () => {
    await closeElectronApp(electronApp);
  });

  test('should launch and display the main window with version in title', async () => {
    // Start button visibility is verified in beforeEach
    // Wait for title to be set after page load
    const expectedTitle = `Tearleads v${packageJson.version}`;
    await expect(async () => {
      const title = await window.title();
      expect(title).toBe(expectedTitle);
    }).toPass({timeout: 5000});
  });

  test('should navigate to settings page', async () => {
    // Navigate via URL for testing page behavior
    await navigateToRoute(window, '/settings');

    await expect(
      window.getByRole('heading', {name: 'Settings'})
    ).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  });

  test('should navigate to tables page', async () => {
    // Navigate via URL for testing page behavior
    await navigateToRoute(window, '/sqlite/tables');

    await expect(
      window.getByRole('heading', {name: 'Tables'})
    ).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  });

  test('should auto-init tables page without inline unlock', async () => {
    // Navigate via URL for testing page behavior
    await navigateToRoute(window, '/sqlite/tables');

    await expect(
      window.getByRole('heading', {name: 'Tables'})
    ).toBeVisible({timeout: APP_LOAD_TIMEOUT});
    await expect(window.getByTestId('inline-unlock')).toHaveCount(0);
  });

  test('should show tables list after auto-init', async () => {
    await navigateToRoute(window, '/sqlite/tables');
    await expect(window.getByRole('heading', {name: 'Tables'})).toBeVisible();

    await expect(window.getByText('user_settings')).toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });
    await expect(window.getByText('schema_migrations')).toBeVisible();
  });
});
