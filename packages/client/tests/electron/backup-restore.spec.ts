import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page
} from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../../out/main/main.js');
const isCI = !!process.env['CI'];

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
  let tempBackupPath: string;

  test.beforeEach(async () => {
    // Create temp directory for backups
    tempBackupPath = join(__dirname, `../../temp-backup-${Date.now()}.db`);

    electronApp = await electron.launch({
      args: isCI ? [mainPath, '--no-sandbox', '--disable-gpu'] : [mainPath]
    });
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(
      window.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Navigate to debug page
    await window.getByTestId('debug-link').click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Reset the database to ensure clean state
    const resetButton = window.getByTestId('db-reset-button');
    await resetButton.click();
    await waitForSuccess(window);
  });

  test.afterEach(async () => {
    await electronApp.close();

    // Clean up temp backup file
    try {
      if (fs.existsSync(tempBackupPath)) {
        fs.unlinkSync(tempBackupPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should display backup section on settings page', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to settings
    await window.getByTestId('settings-link').click();
    await expect(window).toHaveURL(/\/settings/);

    // Verify backup section is visible
    await expect(window.getByText('Backup & Restore')).toBeVisible();
    await expect(window.getByTestId('backup-export-button')).toBeVisible();
    await expect(window.getByText('Create Backup')).toBeVisible();
  });

  test('should export database', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some data
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);

    // Navigate to settings
    await window.getByTestId('settings-link').click();
    await expect(window).toHaveURL(/\/settings/);

    // Wait for export button to be ready
    const exportButton = window.getByTestId('backup-export-button');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();

    // Monitor for downloads
    const downloadPromise = window.waitForEvent('download');

    // Click export button
    await exportButton.click();

    // Wait for download
    const download = await downloadPromise;

    // Verify filename format
    expect(download.suggestedFilename()).toMatch(
      /^rapid-backup-\d{4}-\d{2}-\d{2}-\d{6}\.db$/
    );

    // Save the file and verify it has content
    await download.saveAs(tempBackupPath);
    const stats = fs.statSync(tempBackupPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('should restore from backup and preserve data', async () => {
    // Setup database and write data
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const originalValue = await window.getByTestId('db-test-data').textContent();

    // Export the database
    await window.getByTestId('settings-link').click();
    await expect(window).toHaveURL(/\/settings/);

    const downloadPromise = window.waitForEvent('download');
    await window.getByTestId('backup-export-button').click();
    const download = await downloadPromise;
    await download.saveAs(tempBackupPath);

    // Reset the database and set up fresh
    await window.getByTestId('debug-link').click();
    await window.getByTestId('db-reset-button').click();
    await waitForSuccess(window);
    await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');

    // Set up a fresh database
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify original data is gone
    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);
    const beforeRestore = await window.getByTestId('db-test-data').textContent();
    expect(beforeRestore).not.toBe(originalValue);

    // Navigate to settings and restore from backup
    await window.getByTestId('settings-link').click();
    await expect(window).toHaveURL(/\/settings/);

    const fileInput = window.getByTestId('dropzone-input');
    await fileInput.setInputFiles(tempBackupPath);

    // Confirm restore
    await expect(window.getByTestId('backup-restore-confirm')).toBeVisible({
      timeout: 5000
    });
    await window.getByTestId('backup-restore-confirm').click();

    // After restore, database should be locked (needs re-unlock)
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock with the same password
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to debug and verify data was restored
    await window.getByTestId('debug-link').click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);
    const restoredValue = await window.getByTestId('db-test-data').textContent();

    expect(restoredValue).toBe(originalValue);
  });

  test('should persist restored data across app restarts', async () => {
    // Setup database and write data
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const originalValue = await window.getByTestId('db-test-data').textContent();

    // Export the database
    await window.getByTestId('settings-link').click();
    const downloadPromise = window.waitForEvent('download');
    await window.getByTestId('backup-export-button').click();
    const download = await downloadPromise;
    await download.saveAs(tempBackupPath);

    // Reset the database
    await window.getByTestId('debug-link').click();
    await window.getByTestId('db-reset-button').click();
    await waitForSuccess(window);

    // Set up fresh database
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Restore from backup
    await window.getByTestId('settings-link').click();
    await window.getByTestId('dropzone-input').setInputFiles(tempBackupPath);
    await expect(window.getByTestId('backup-restore-confirm')).toBeVisible({
      timeout: 5000
    });
    await window.getByTestId('backup-restore-confirm').click();

    // Unlock after restore
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Close the app
    await electronApp.close();

    // Relaunch the app
    electronApp = await electron.launch({
      args: isCI ? [mainPath, '--no-sandbox', '--disable-gpu'] : [mainPath]
    });
    window = await electronApp.firstWindow();

    // Wait for app to load and navigate to debug
    await expect(
      window.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await window.getByTestId('debug-link').click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Database should be locked
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock with password
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify restored data persisted across restart
    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);
    const readValue = await window.getByTestId('db-test-data').textContent();

    expect(readValue).toBe(originalValue);
  });

  test('should show error for invalid file type', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to settings
    await window.getByTestId('settings-link').click();
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
