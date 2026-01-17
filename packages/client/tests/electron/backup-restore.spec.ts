import {
  test,
  expect,
  ElectronApplication,
  Page
} from '@playwright/test';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
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

async function openSidebar(window: Page) {
  const startButton = window.getByTestId('start-button');
  await expect(startButton).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  await startButton.click();
  await expect(window.locator('nav')).toBeVisible({timeout: APP_LOAD_TIMEOUT});
}

test.describe('Backup & Restore (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(
      window.getByTestId('start-button')
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Open sidebar and navigate to SQLite page
    await openSidebar(window);
    await window.locator('nav').getByRole('button', { name: 'SQLite' }).click();
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

    // Reopen sidebar and navigate to settings
    await openSidebar(window);
    await window.locator('nav').getByRole('button', { name: 'Settings' }).click();
    await expect(window).toHaveURL(/\/settings/);

    // Verify backup section is visible
    await expect(window.getByText('Backup & Restore')).toBeVisible();
    await expect(window.getByTestId('backup-export-button')).toBeVisible();
    await expect(window.getByText('Create Backup')).toBeVisible();
  });

  // This test requires mocking Electron's native file dialog
  // which is not supported in Playwright's Electron testing
  test.skip('should export database', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to settings via sidebar
    await window.locator('nav').getByRole('button', { name: 'Settings' }).click();
    await expect(window).toHaveURL(/\/settings/);

    const exportButton = window.getByTestId('backup-export-button');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();

    const downloadPromise = window.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^rapid-backup-\d{4}-\d{2}-\d{2}-\d{6}\.db$/
    );
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  // Depends on export test which requires native file dialog mocking
  test.skip('should restore from backup and preserve data', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some data
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const originalValue = await window
      .getByTestId('db-test-data')
      .textContent();

    // Export database
    const downloadPromise = window.waitForEvent('download');
    await window.locator('nav').getByRole('button', { name: 'Settings' }).click();
    await expect(window).toHaveURL(/\/settings/);
    await window.getByTestId('backup-export-button').click();
    const download = await downloadPromise;

    const backupPath = join(tmpdir(), `rapid-electron-backup-${Date.now()}.db`);
    await download.saveAs(backupPath);

    try {
      // Reset database
      await window.locator('nav').getByRole('button', { name: 'SQLite' }).click();
      await expect(window).toHaveURL(/\/sqlite/);
      await window.getByTestId('db-reset-button').click();
      await waitForSuccess(window);
      await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');

      // Set up a fresh database
      await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await window.getByTestId('db-setup-button').click();
      await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });

      // Restore from backup
      await window.locator('nav').getByRole('button', { name: 'Settings' }).click();
      await expect(window).toHaveURL(/\/settings/);
      const fileInput = window.getByTestId('dropzone-input');
      await fileInput.setInputFiles(backupPath);

      await expect(window.getByTestId('backup-restore-confirm')).toBeVisible({
        timeout: 5000
      });
      await window.getByTestId('backup-restore-confirm').click();

      // After restore, unlock and verify data
      await window.locator('nav').getByRole('button', { name: 'SQLite' }).click();
      await expect(window).toHaveURL(/\/sqlite/);
      await expect(window.getByTestId('db-status')).toHaveText('Locked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await window.getByTestId('db-unlock-button').click();
      await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      await window.getByTestId('db-read-button').click();
      await waitForSuccess(window);
      const restoredValue = await window
        .getByTestId('db-test-data')
        .textContent();

      expect(restoredValue).toBe(originalValue);
    } finally {
      fs.unlinkSync(backupPath);
    }
  });

  // Depends on restore test which requires native file dialog mocking
  test.skip('should persist restored data across app restarts', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const originalValue = await window
      .getByTestId('db-test-data')
      .textContent();

    const downloadPromise = window.waitForEvent('download');
    await window.locator('nav').getByRole('button', { name: 'Settings' }).click();
    await expect(window).toHaveURL(/\/settings/);
    await window.getByTestId('backup-export-button').click();
    const download = await downloadPromise;

    const backupPath = join(tmpdir(), `rapid-electron-restart-${Date.now()}.db`);
    await download.saveAs(backupPath);

    try {
      await window.locator('nav').getByRole('button', { name: 'SQLite' }).click();
      await expect(window).toHaveURL(/\/sqlite/);
      await window.getByTestId('db-reset-button').click();
      await waitForSuccess(window);

      await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await window.getByTestId('db-setup-button').click();
      await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });

      await window.locator('nav').getByRole('button', { name: 'Settings' }).click();
      await expect(window).toHaveURL(/\/settings/);
      await window.getByTestId('dropzone-input').setInputFiles(backupPath);
      await expect(window.getByTestId('backup-restore-confirm')).toBeVisible({
        timeout: 5000
      });
      await window.getByTestId('backup-restore-confirm').click();

      await electronApp.close();
      electronApp = await launchElectronApp();
      window = await electronApp.firstWindow();

      await expect(
        window.getByTestId('start-button')
      ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

      await openSidebar(window);
      await window.locator('nav').getByRole('button', { name: 'SQLite' }).click();
      await expect(window.getByTestId('database-test')).toBeVisible();
      await expect(window.getByTestId('db-status')).toHaveText('Locked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await window.getByTestId('db-unlock-button').click();
      await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      await window.getByTestId('db-read-button').click();
      await waitForSuccess(window);
      const restoredValue = await window
        .getByTestId('db-test-data')
        .textContent();

      expect(restoredValue).toBe(originalValue);
    } finally {
      fs.unlinkSync(backupPath);
    }
  });

  test('should show error for invalid file type', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Reopen sidebar and navigate to settings
    await openSidebar(window);
    await window.locator('nav').getByRole('button', { name: 'Settings' }).click();
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
