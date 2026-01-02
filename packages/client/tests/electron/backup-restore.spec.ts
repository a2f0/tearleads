import {
  test,
  expect,
  ElectronApplication,
  Page
} from '@playwright/test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as fs from 'node:fs';
import {launchElectronApp} from './electron-test-helper';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;
const APP_LOAD_TIMEOUT = 10000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

test.describe('Backup & Restore (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(
      window.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Navigate to SQLite page via sidebar (visible on desktop)
    await window.locator('nav').getByRole('link', { name: 'SQLite' }).click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Reset the database to ensure clean state
    const resetButton = window.getByTestId('db-reset-button');
    await resetButton.click();
    await waitForSuccess(window);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should display backup section on settings page', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to settings via sidebar
    await window.locator('nav').getByRole('link', { name: 'Settings' }).click();
    await expect(window).toHaveURL(/\/settings/);

    // Verify backup section is visible
    await expect(window.getByText('Backup & Restore')).toBeVisible();
    await expect(window.getByTestId('backup-export-button')).toBeVisible();
    await expect(window.getByText('Create Backup')).toBeVisible();
  });

  // Skip export/restore tests that require download events
  // Electron uses native file dialogs instead of browser download events
  // These tests would need to mock electron's dialog.showSaveDialog
  test.skip('should export database', async () => {
    // This test requires mocking Electron's native file dialog
    // which is not supported in Playwright's Electron testing
  });

  test.skip('should restore from backup and preserve data', async () => {
    // This test requires export functionality which uses native dialogs
  });

  test.skip('should persist restored data across app restarts', async () => {
    // This test requires export functionality which uses native dialogs
  });

  test('should show error for invalid file type', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to settings via sidebar
    await window.locator('nav').getByRole('link', { name: 'Settings' }).click();
    await expect(window).toHaveURL(/\/settings/);

    // Create and upload an invalid file
    const invalidFilePath = join(__dirname, `../../temp-invalid-${Date.now()}.txt`);
    fs.writeFileSync(invalidFilePath, 'not a database file');

    try {
      const fileInput = window.getByTestId('dropzone-input');
      await fileInput.setInputFiles(invalidFilePath);

      // Should show error message
      await expect(
        window.getByText('Please select a .db backup file')
      ).toBeVisible({ timeout: 5000 });
    } finally {
      // Cleanup
      fs.unlinkSync(invalidFilePath);
    }
  });
});
