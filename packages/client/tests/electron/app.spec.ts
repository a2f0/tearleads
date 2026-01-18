import {test, expect, ElectronApplication, Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {launchElectronApp} from './electron-test-helper';

const require = createRequire(import.meta.url);
const packageJson: { version: string } = require('../../package.json');

const APP_LOAD_TIMEOUT = 10000;
const DB_OPERATION_TIMEOUT = 15000;

async function openSidebar(window: Page) {
  const startButton = window.getByTestId('start-button');
  await expect(startButton).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  await startButton.click();
  // Wait for sidebar to be visible
  await expect(window.locator('nav')).toBeVisible({timeout: APP_LOAD_TIMEOUT});
}

test.describe('Electron App', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should launch and display the main window with version in title', async () => {
    // Verify Start button is visible (main entry point to navigation)
    const startButton = window.getByTestId('start-button');
    await expect(startButton).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    // Wait for title to be set after page load
    const expectedTitle = `Tearleads v${packageJson.version}`;
    await expect(async () => {
      const title = await window.title();
      expect(title).toBe(expectedTitle);
    }).toPass({timeout: 5000});
  });

  test('should navigate to settings page', async () => {
    // Open sidebar via Start button
    await openSidebar(window);

    const settingsButton = window
      .locator('nav')
      .getByRole('button', { name: 'Settings' });
    await settingsButton.dblclick();

    await expect(
      window.getByRole('heading', {name: 'Settings'})
    ).toBeVisible();
  });

  test('should navigate to tables page', async () => {
    // Open sidebar via Start button
    await openSidebar(window);

    const tablesButton = window
      .locator('nav')
      .getByRole('button', { name: 'Tables' });
    await tablesButton.dblclick();

    await expect(
      window.getByRole('heading', {name: 'Tables'})
    ).toBeVisible();
  });

  test('should show inline unlock on tables page when database not unlocked', async () => {
    // Open sidebar via Start button
    await openSidebar(window);

    await window
      .locator('nav')
      .getByRole('button', { name: 'Tables' })
      .dblclick();

    // Should show inline unlock component
    await expect(window.getByTestId('inline-unlock')).toBeVisible({timeout: APP_LOAD_TIMEOUT});
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      window.getByText(/Database is (locked|not set up)/)
    ).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  });

  test('should show tables list after database is unlocked', async () => {
    // Open sidebar via Start button
    await openSidebar(window);

    // Setup database via SQLite page (using sidebar navigation)
    await window
      .locator('nav')
      .getByRole('button', { name: 'SQLite' })
      .dblclick();
    await expect(window.getByTestId('database-test')).toBeVisible({timeout: APP_LOAD_TIMEOUT});

    // Reset and wait for reset to complete
    await window.getByTestId('db-reset-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      {timeout: DB_OPERATION_TIMEOUT}
    );
    await expect(window.getByTestId('db-status')).toContainText('Not Set Up', {timeout: APP_LOAD_TIMEOUT});

    // Setup database and wait for setup to complete
    await window.getByTestId('db-password-input').fill('testpassword123');
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      {timeout: DB_OPERATION_TIMEOUT}
    );
    await expect(window.getByTestId('db-status')).toContainText('Unlocked', {timeout: APP_LOAD_TIMEOUT});

    // Reopen sidebar and navigate to tables page
    await openSidebar(window);
    await window
      .locator('nav')
      .getByRole('button', { name: 'Tables' })
      .dblclick();
    await expect(window.getByRole('heading', {name: 'Tables'})).toBeVisible();

    // Should show tables
    await expect(window.getByText('user_settings')).toBeVisible({timeout: APP_LOAD_TIMEOUT});
    await expect(window.getByText('schema_migrations')).toBeVisible();
  });
});
