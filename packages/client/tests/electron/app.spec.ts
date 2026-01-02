import {test, expect, _electron as electron, ElectronApplication, Page} from '@playwright/test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as {version: string};

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../../out/main/main.js');
const isCI = !!process.env['CI'];
const APP_LOAD_TIMEOUT = 10000;

test.describe('Electron App', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await electron.launch({
      args: isCI ? [mainPath, '--no-sandbox', '--disable-gpu'] : [mainPath],
    });
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should launch and display the main window with version in title', async () => {
    const heading = window.getByRole('heading', {name: 'Tearleads', level: 1});
    await expect(heading).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    // Wait for title to be set after page load
    const expectedTitle = `Tearleads v${packageJson.version}`;
    await expect(async () => {
      const title = await window.title();
      expect(title).toBe(expectedTitle);
    }).toPass({timeout: 5000});
  });

  test('should navigate to settings page', async () => {
    // Use sidebar navigation (visible on desktop)
    const settingsLink = window.locator('nav').getByRole('link', { name: 'Settings' });
    await expect(settingsLink).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    await settingsLink.click();

    await expect(
      window.getByRole('heading', {name: 'Settings'})
    ).toBeVisible();
  });

  test('should navigate to tables page', async () => {
    // Use sidebar navigation (visible on desktop)
    const tablesLink = window.locator('nav').getByRole('link', { name: 'Tables' });
    await expect(tablesLink).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    await tablesLink.click();

    await expect(
      window.getByRole('heading', {name: 'Tables'})
    ).toBeVisible();
  });

  test('should show inline unlock on tables page when database not unlocked', async () => {
    await window.locator('nav').getByRole('link', { name: 'Tables' }).click();

    // Should show inline unlock component
    await expect(window.getByTestId('inline-unlock')).toBeVisible({timeout: APP_LOAD_TIMEOUT});
    await expect(
      window.getByText('Database is locked. Enter your password to view tables.')
    ).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  });

  test('should show tables list after database is unlocked', async () => {
    // Setup database via SQLite page (using sidebar navigation)
    await window.locator('nav').getByRole('link', { name: 'SQLite' }).click();
    await expect(window.getByTestId('database-test')).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    // Reset and setup
    await window.getByTestId('db-reset-button').click();
    await expect(window.getByTestId('db-status')).toContainText('Not Set Up', {timeout: 10000});

    await window.getByTestId('db-password-input').fill('testpassword123');
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toContainText('Unlocked', {timeout: 10000});

    // Navigate to tables page via sidebar
    await window.locator('nav').getByRole('link', { name: 'Tables' }).click();
    await expect(window.getByRole('heading', {name: 'Tables'})).toBeVisible();

    // Should show tables
    await expect(window.getByText('user_settings')).toBeVisible({timeout: 10000});
    await expect(window.getByText('schema_migrations')).toBeVisible();
  });
});
