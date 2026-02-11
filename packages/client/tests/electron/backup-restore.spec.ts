import { ElectronApplication, Page, test, expect } from '@playwright/test';
import { closeElectronApp, launchElectronApp } from './electron-test-helper';
import {
  BACKUP_PASSWORD,
  BACKUP_TIMEOUT,
  DB_OPERATION_TIMEOUT,
  TEST_PASSWORD,
  navigateInApp,
  setupDatabaseForBackup,
  writeDatabaseTestData
} from '../../src/lib/testing/backupRestoreE2eHelpers';

const APP_LOAD_TIMEOUT = 10000;

test.describe('Backup and Restore (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(window.getByTestId('start-button')).toBeVisible({
      timeout: APP_LOAD_TIMEOUT
    });

    // Navigate to SQLite page and reset
    await navigateInApp(window, '/sqlite');
    await expect(window.getByTestId('database-test')).toBeVisible();
    await window.getByTestId('db-reset-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
  });

  test.afterEach(async () => {
    await closeElectronApp(electronApp);
  });

  test('should create a backup file', async () => {
    // Setup database
    await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');
    await setupDatabaseForBackup(window, async (path) => navigateInApp(window, path));
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write test data
    const writtenValue = await writeDatabaseTestData(window);
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    // Navigate to backups page
    await navigateInApp(window, '/backups');
    const passwordInput = window.getByLabel('Password');
    await expect(passwordInput).toBeVisible({
      timeout: 10000
    });

    // Fill in backup password
    await passwordInput.fill(BACKUP_PASSWORD);
    await window.getByLabel('Confirm').fill(BACKUP_PASSWORD);

    // Click Create Backup
    await window.getByRole('button', { name: 'Create Backup' }).click();

    // Wait for backup to complete (success message appears)
    const successMessage = window.getByText(/Backup saved as.*\.tbu/);
    await expect(successMessage).toBeVisible({
      timeout: BACKUP_TIMEOUT
    });

    // Verify the backup appears in the list with a Download button
    const downloadButton = window
      .getByRole('button', { name: 'Download' })
      .first();
    await expect(downloadButton).toBeVisible({ timeout: 5000 });
  });

  test('should verify database integrity after backup export', async () => {
    // Setup database
    await setupDatabaseForBackup(window, async (path) => navigateInApp(window, path));
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write test data
    const writtenValue = await writeDatabaseTestData(window);
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Navigate to backups and create backup
    await navigateInApp(window, '/backups');
    await window.getByLabel('Password').fill(BACKUP_PASSWORD);
    await window.getByLabel('Confirm').fill(BACKUP_PASSWORD);
    await window.getByRole('button', { name: 'Create Backup' }).click();

    // Wait for backup to complete
    await expect(window.getByText(/Backup saved as.*\.tbu/)).toBeVisible({
      timeout: BACKUP_TIMEOUT
    });

    // Navigate back to SQLite page
    await navigateInApp(window, '/sqlite');
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read data and verify it matches
    await window.getByTestId('db-read-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT
      }
    );
    const readValue = await window.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });

  test('should persist backup data across app restarts', async () => {
    // Setup database and write data
    await setupDatabaseForBackup(window, async (path) => navigateInApp(window, path));
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    const writtenValue = await writeDatabaseTestData(window);
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Create backup
    await navigateInApp(window, '/backups');
    await window.getByLabel('Password').fill(BACKUP_PASSWORD);
    await window.getByLabel('Confirm').fill(BACKUP_PASSWORD);
    await window.getByRole('button', { name: 'Create Backup' }).click();

    // Wait for backup to complete
    await expect(window.getByText(/Backup saved as.*\.tbu/)).toBeVisible({
      timeout: BACKUP_TIMEOUT
    });

    // Close and relaunch app without clearing storage
    await closeElectronApp(electronApp);
    electronApp = await launchElectronApp({ clearStorage: false });
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(window.getByTestId('start-button')).toBeVisible({
      timeout: APP_LOAD_TIMEOUT
    });

    // Navigate to SQLite
    await navigateInApp(window, '/sqlite');
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Database should be locked (set up but not unlocked)
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock with password
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read and verify data persisted
    await window.getByTestId('db-read-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const readValue = await window.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });
});
