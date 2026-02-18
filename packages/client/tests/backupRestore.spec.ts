import { expect, test } from './fixtures';
import { clearOriginStorage } from './testUtils';
import {
  BACKUP_PASSWORD,
  BACKUP_TIMEOUT,
  DB_OPERATION_TIMEOUT,
  navigateInApp,
  setupDatabaseForBackup,
  writeDatabaseTestData
} from '../src/lib/testing/backupRestoreE2eHelpers';

test.beforeEach(async ({ page }) => {
  await clearOriginStorage(page);
});

test.describe('Backup and Restore', () => {
  test('should show backup progress or completion state when creating backup', async ({
    page
  }) => {
    test.slow();

    await page.goto('/');
    await setupDatabaseForBackup(page, async (path) =>
      navigateInApp(page, path, true)
    );
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some test data
    const writtenValue = await writeDatabaseTestData(page);
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    // Navigate to backups page
    await navigateInApp(page, '/backups', true);

    // Wait for backup form to be visible
    const passwordInput = page.getByLabel('Password', { exact: true });
    await expect(passwordInput).toBeVisible({
      timeout: 10000
    });

    // Fill in backup password
    await passwordInput.fill(BACKUP_PASSWORD);
    await page.getByLabel('Confirm', { exact: true }).fill(BACKUP_PASSWORD);

    // Keep backup scope limited to DB data for deterministic web e2e runtime.
    const includeBlobsCheckbox = page.getByRole('checkbox', {
      name: /include files/i
    });
    if (await includeBlobsCheckbox.isChecked()) {
      await includeBlobsCheckbox.uncheck();
    }

    // Click Create Backup
    await page.getByRole('button', { name: 'Create Backup' }).click();

    const createButton = page.getByTestId('backup-create-button');
    const canClickCreate = await createButton.isVisible().catch(() => false);
    if (canClickCreate) {
      await createButton.click();
    }

    const progressOrCompletion = await page
      .waitForFunction(() => {
        const hasFinalizing = Array.from(document.querySelectorAll('*')).some(
          (el) => el.textContent?.trim() === 'Finalizing'
        );
        const hasSuccessMessage =
          document.querySelector('[data-testid="backup-success"]') !== null;
        const hasStoredDownloadButton = Array.from(
          document.querySelectorAll('button')
        ).some((button) => button.textContent?.trim() === 'Download');
        return hasFinalizing || hasSuccessMessage || hasStoredDownloadButton;
      }, undefined, { timeout: BACKUP_TIMEOUT })
      .then(() => true)
      .catch(() => false);

    expect(progressOrCompletion).toBe(true);
  });

  test('should preserve database integrity while backup is running', async ({
    page
  }) => {
    test.slow();

    await page.goto('/');
    await setupDatabaseForBackup(page, async (path) =>
      navigateInApp(page, path, true)
    );
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write test data and store the value
    const writtenValue = await writeDatabaseTestData(page);
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Navigate to backups and create backup
    await navigateInApp(page, '/backups', true);
    await page.getByLabel('Password', { exact: true }).fill(BACKUP_PASSWORD);
    await page.getByLabel('Confirm', { exact: true }).fill(BACKUP_PASSWORD);
    const includeBlobsCheckbox = page.getByRole('checkbox', {
      name: /include files/i
    });
    if (await includeBlobsCheckbox.isChecked()) {
      await includeBlobsCheckbox.uncheck();
    }
    await page.getByRole('button', { name: 'Create Backup' }).click();
    await expect(page.getByText(/Preparing|Backing up database|Finalizing/))
      .toBeVisible({ timeout: BACKUP_TIMEOUT });

    // Navigate back to SQLite page
    await navigateInApp(page, '/sqlite', true);
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read data and verify it matches
    await page.getByTestId('db-read-button').click();
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const readValue = await page.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });

  test('should show backup activity when creating backup with locked database', async ({
    page
  }) => {
    await page.goto('/');
    await setupDatabaseForBackup(page, async (path) =>
      navigateInApp(page, path, true)
    );
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to backups
    await navigateInApp(page, '/backups', true);

    // Fill in backup form
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible({
      timeout: 10000
    });
    await page.getByLabel('Password', { exact: true }).fill(BACKUP_PASSWORD);
    await page.getByLabel('Confirm', { exact: true }).fill(BACKUP_PASSWORD);

    // Attempt to create backup with locked database
    await page.getByRole('button', { name: 'Create Backup' }).click();

    // Verify backup activity becomes visible (progress or completion state).
    const hasBackupActivity = await page
      .waitForFunction(() => {
        const hasPhaseText = Array.from(document.querySelectorAll('*')).some(
          (el) => {
            const text = el.textContent?.trim();
            return (
              text === 'Preparing' ||
              text === 'Backing up database' ||
              text === 'Finalizing'
            );
          }
        );
        const hasSuccessMessage =
          document.querySelector('[data-testid="backup-success"]') !== null;
        const hasStoredDownloadButton = Array.from(
          document.querySelectorAll('button')
        ).some((button) => button.textContent?.trim() === 'Download');
        return hasPhaseText || hasSuccessMessage || hasStoredDownloadButton;
      }, undefined, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    expect(hasBackupActivity).toBe(true);
  });
});
