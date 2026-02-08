import type { Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { clearOriginStorage, MINIMAL_PNG } from './test-utils';
import {
  BACKUP_PASSWORD,
  BACKUP_TIMEOUT,
  DB_OPERATION_TIMEOUT,
  navigateInApp,
  setupDatabaseForBackup,
  writeDatabaseTestData
} from '../src/lib/testing/backupRestoreE2eHelpers';

// Artifact directory for backup files - CI will upload these
const BACKUP_ARTIFACT_DIR = join(
  process.cwd(),
  'playwright-report',
  'backups'
);

test.beforeEach(async ({ page }) => {
  await clearOriginStorage(page);
});

// Helper to upload a test photo (creates blob data in VFS)
async function uploadTestPhoto(page: Page, name = 'test-photo.png') {
  await navigateInApp(page, '/photos', true);

  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: MINIMAL_PNG
  });

  await expect(page.getByText('1 photo')).toBeVisible({ timeout: 60000 });
}

test.describe('Backup and Restore', () => {
  test('should create and download a backup file', async ({ page }) => {
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

    // Upload a test photo to have blob data
    await uploadTestPhoto(page);

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

    // Ensure "Include files" checkbox is checked
    const includeBlobsCheckbox = page.getByRole('checkbox', {
      name: /include files/i
    });
    if (!(await includeBlobsCheckbox.isChecked())) {
      await includeBlobsCheckbox.check();
    }

    // Click Create Backup
    await page.getByRole('button', { name: 'Create Backup' }).click();

    // Wait for backup to complete (success message appears)
    // Look for the success message containing the backup filename
    const successMessage = page.getByText(/Backup saved as.*\.rbu/);
    await expect(successMessage).toBeVisible({
      timeout: BACKUP_TIMEOUT
    });

    // The backup is saved to OPFS storage. Click Download to get the file.
    // Find the first backup in the stored backups list and click Download
    const downloadButton = page
      .getByRole('button', { name: 'Download' })
      .first();
    await expect(downloadButton).toBeVisible({ timeout: 5000 });

    // Start waiting for download before clicking
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;

    // Verify the download has the correct extension
    expect(download.suggestedFilename()).toMatch(/^rapid-backup-.*\.rbu$/);

    // Ensure artifact directory exists
    await mkdir(BACKUP_ARTIFACT_DIR, { recursive: true });

    // Save the backup to the artifact directory for CI validation
    const backupPath = join(BACKUP_ARTIFACT_DIR, 'web-backup.rbu');
    await download.saveAs(backupPath);

    // Verify the file was saved
    expect(existsSync(backupPath)).toBe(true);
  });

  test('should verify database integrity after backup export', async ({
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
    await page.getByRole('button', { name: 'Create Backup' }).click();
    await expect(page.getByText(/Backup saved as.*\.rbu/)).toBeVisible({
      timeout: BACKUP_TIMEOUT
    });

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

  test('should show error when creating backup with locked database', async ({
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

    // Verify error message appears
    const errorMessage = page.getByTestId('backup-error');
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
    await expect(errorMessage).toContainText('Database not initialized');
  });
});
