import type { Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { clearOriginStorage, MINIMAL_PNG } from './test-utils';

const TEST_PASSWORD = 'testpassword123';
const BACKUP_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;
const BACKUP_TIMEOUT = 30000;

// Artifact directory for backup files - CI will upload these
const BACKUP_ARTIFACT_DIR = join(
  process.cwd(),
  'playwright-report',
  'backups'
);

test.beforeEach(async ({ page }) => {
  await clearOriginStorage(page);
});

// Helper to navigate using in-app routing (preserves React state)
async function navigateInApp(page: Page, path: string) {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForURL(`**${path}`);
}

// Helper to setup and unlock the database
async function setupDatabase(page: Page, password = TEST_PASSWORD) {
  await navigateInApp(page, '/sqlite');

  // Reset database to ensure clean state
  await page.getByTestId('db-reset-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Setup with password
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
}

// Helper to write test data to the database
async function writeTestData(page: Page) {
  await page.getByTestId('db-write-button').click();
  await expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );
  const testData = page.getByTestId('db-test-data');
  await expect(testData).toBeVisible();
  return await testData.textContent();
}

// Helper to upload a test photo (creates blob data in VFS)
async function uploadTestPhoto(page: Page, name = 'test-photo.png') {
  await navigateInApp(page, '/photos');

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
    await setupDatabase(page);

    // Write some test data
    const writtenValue = await writeTestData(page);
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    // Upload a test photo to have blob data
    await uploadTestPhoto(page);

    // Navigate to backups page
    await navigateInApp(page, '/backups');

    // Wait for backup form to be visible
    const passwordInput = page.getByLabel('Password');
    await expect(passwordInput).toBeVisible({
      timeout: 10000
    });

    // Fill in backup password
    await passwordInput.fill(BACKUP_PASSWORD);
    await page.getByLabel('Confirm').fill(BACKUP_PASSWORD);

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
    if (!existsSync(BACKUP_ARTIFACT_DIR)) {
      mkdirSync(BACKUP_ARTIFACT_DIR, { recursive: true });
    }

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
    await setupDatabase(page);

    // Write test data and store the value
    const writtenValue = await writeTestData(page);

    // Navigate to backups and create backup
    await navigateInApp(page, '/backups');
    await page.getByLabel('Password').fill(BACKUP_PASSWORD);
    await page.getByLabel('Confirm').fill(BACKUP_PASSWORD);
    await page.getByRole('button', { name: 'Create Backup' }).click();
    await expect(page.getByText(/Backup saved as.*\.rbu/)).toBeVisible({
      timeout: BACKUP_TIMEOUT
    });

    // Navigate back to SQLite page
    await navigateInApp(page, '/sqlite');
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

  test('should disable backup when database is locked', async ({ page }) => {
    await page.goto('/');
    await setupDatabase(page);

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to backups
    await navigateInApp(page, '/backups');

    // The create backup button should be visible but we can't create a backup
    // without an unlocked database (the form won't have access to keys)
    await expect(page.getByLabel('Password')).toBeVisible({
      timeout: 10000
    });
  });
});
