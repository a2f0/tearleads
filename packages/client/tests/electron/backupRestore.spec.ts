import { ElectronApplication, Page, test, expect } from '@playwright/test';
import { closeElectronApp, launchElectronApp } from './electronTestHelper';
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

  test('should restore backup to new instance', async () => {
    // Setup database and write unique test data
    await setupDatabaseForBackup(window, async (path) =>
      navigateInApp(window, path)
    );
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    const writtenValue = await writeDatabaseTestData(window);
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    // Navigate to backups and create backup
    await navigateInApp(window, '/backups');
    await window.getByLabel('Password').fill(BACKUP_PASSWORD);
    await window.getByLabel('Confirm').fill(BACKUP_PASSWORD);
    await window.getByRole('button', { name: 'Create Backup' }).click();

    // Wait for backup to complete
    await expect(window.getByText(/Backup saved as.*\.tbu/)).toBeVisible({
      timeout: BACKUP_TIMEOUT
    });

    // Wait for the Restore button to appear in the stored backups list
    const restoreButton = window
      .getByRole('button', { name: 'Restore' })
      .first();
    await expect(restoreButton).toBeVisible({ timeout: 5000 });

    // Click Restore to start restore flow
    await restoreButton.click();

    // Enter backup password to validate
    const backupPwdInput = window.getByPlaceholder("Enter the backup's password");
    await expect(backupPwdInput).toBeVisible({ timeout: 5000 });
    await backupPwdInput.fill(BACKUP_PASSWORD);

    // Click Validate Backup
    await window.getByRole('button', { name: 'Validate Backup' }).click();

    // Wait for validation - new instance password fields should appear
    const newPwdInput = window.getByPlaceholder('Password for restored instance');
    await expect(newPwdInput).toBeVisible({ timeout: 10000 });

    // Enter new instance password
    const NEW_INSTANCE_PASSWORD = 'newinstance123';
    await newPwdInput.fill(NEW_INSTANCE_PASSWORD);
    // Use the label-associated input to avoid matching the backup creation form
    await window.getByLabel('Confirm Password').fill(NEW_INSTANCE_PASSWORD);

    // Click Restore Backup - this exercises the importDatabase() code path
    await window.getByRole('button', { name: 'Restore Backup' }).click();

    // Wait for restore to complete - success message should appear
    const successMessage = window.getByText(/Backup restored successfully/);
    await expect(successMessage).toBeVisible({ timeout: BACKUP_TIMEOUT });

    // Verify the success message mentions the instance name
    const successText = await successMessage.textContent();
    expect(successText).toContain('instance selector');
  });
});
