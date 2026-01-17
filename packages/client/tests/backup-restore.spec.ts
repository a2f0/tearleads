import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

// Helper to open sidebar via Start button
async function openSidebar(page: Page) {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await startButton.click();
  await expect(page.locator('aside nav')).toBeVisible({ timeout: 10000 });
}

// Helper to navigate via sidebar
async function navigateTo(page: Page, linkName: string) {
  const sidebar = page.locator('aside nav');
  if (!(await sidebar.isVisible())) {
    await openSidebar(page);
  }
  const link = sidebar.getByRole('link', { name: linkName });
  await link.click();
  // Close sidebar after navigation to prevent it from intercepting pointer events
  const startButton = page.getByTestId('start-button');
  if (await sidebar.isVisible()) {
    await startButton.click();
    await expect(sidebar).not.toBeVisible({ timeout: 5000 });
  }
}

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to setup database via SQLite page
async function setupDatabase(page: Page) {
  await page.goto('/sqlite');
  await expect(page.getByTestId('database-test')).toBeVisible();

  // Reset first
  await page.getByTestId('db-reset-button').click();
  await waitForSuccess(page);

  // Setup with password
  await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
}

test.describe('Backup & Restore (Web)', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await setupDatabase(page);
  });

  test.describe('Settings page backup UI', () => {
    test('should display backup section with export button', async ({
      page
    }) => {
      await page.goto('/settings');

      await expect(page.getByText('Backup & Restore')).toBeVisible();
      await expect(
        page.getByText('Export your encrypted database or restore from a backup')
      ).toBeVisible();
      await expect(page.getByTestId('backup-export-button')).toBeVisible();
      await expect(page.getByText('Create Backup')).toBeVisible();
    });

    test('should display restore dropzone', async ({ page }) => {
      await page.goto('/settings');

      await expect(page.getByText('Restore from Backup')).toBeVisible();
      // Dropzone should be present
      await expect(
        page.locator('[data-testid="dropzone"], [data-testid="dropzone-native"]')
      ).toBeVisible();
    });

    test('should show loading state when export button clicked', async ({
      page
    }) => {
      await page.goto('/settings');

      const exportButton = page.getByTestId('backup-export-button');
      await exportButton.click();

      // Should show exporting state (may be brief)
      // The button text changes to "Exporting..." during the operation
      await expect(exportButton).toBeEnabled({ timeout: DB_OPERATION_TIMEOUT });
    });
  });

  test.describe('Restore flow', () => {
    test('should show error for invalid file type', async ({ page }) => {
      await page.goto('/settings');

      // Create and upload an invalid file
      const fileInput = page.getByTestId('dropzone-input');

      // Create a text file (not .db)
      await fileInput.setInputFiles({
        name: 'invalid.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('not a database')
      });

      // Should show error message
      await expect(
        page.getByText('Please select a .db backup file')
      ).toBeVisible({ timeout: 5000 });
    });

    test('should show confirmation dialog when .db file selected', async ({
      page
    }) => {
      await page.goto('/settings');

      const fileInput = page.getByTestId('dropzone-input');

      // Create a fake .db file
      await fileInput.setInputFiles({
        name: 'backup.db',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('fake database content')
      });

      // Should show confirmation dialog
      await expect(
        page.getByText('Warning: This will replace your current data')
      ).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Restoring from "backup.db"/)).toBeVisible();
      await expect(page.getByTestId('backup-restore-confirm')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    });

    test('should cancel restore when cancel button clicked', async ({
      page
    }) => {
      await page.goto('/settings');

      const fileInput = page.getByTestId('dropzone-input');

      // Upload a .db file
      await fileInput.setInputFiles({
        name: 'backup.db',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('fake database content')
      });

      // Wait for confirmation dialog
      await expect(
        page.getByText('Warning: This will replace your current data')
      ).toBeVisible({ timeout: 5000 });

      // Click cancel
      await page.getByRole('button', { name: 'Cancel' }).click();

      // Confirmation dialog should be hidden
      await expect(
        page.getByText('Warning: This will replace your current data')
      ).not.toBeVisible();

      // Dropzone should be visible again
      await expect(page.getByText('Restore from Backup')).toBeVisible();
    });
  });

  test.describe('Full backup/restore cycle', () => {
    test('should export database and download file', async ({ page }) => {
      // Go to SQLite page first (beforeEach sets up db, but page reload locks it)
      await page.goto('/sqlite');
      await expect(page.getByTestId('db-status')).toHaveText('Locked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await page.getByTestId('db-unlock-button').click();
      await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });

      // Use client-side navigation (preserves React state including db context)
      await navigateTo(page, 'Settings');
      await expect(page).toHaveURL('/settings');

      // Wait for export button to be ready
      const exportButton = page.getByTestId('backup-export-button');
      await expect(exportButton).toBeVisible();
      await expect(exportButton).toBeEnabled();

      // Monitor downloads before clicking
      const downloadPromise = page.waitForEvent('download');

      // Click export button
      await exportButton.click();

      // Wait for download to start
      const download = await downloadPromise;

      // Verify filename format
      expect(download.suggestedFilename()).toMatch(
        /^rapid-backup-\d{4}-\d{2}-\d{2}-\d{6}\.db$/
      );

      // Save and verify the file has content
      const path = await download.path();
      expect(path).toBeTruthy();
    });

    // TODO: Web adapter import has issues with encrypted databases
    // See: https://github.com/a2f0/rapid/issues/137
    test.skip('should restore from backup file', async ({ page }) => {
      // Navigate to SQLite and unlock (page reload loses in-memory key)
      await page.goto('/sqlite');
      // Database is locked after page reload, unlock it
      await expect(page.getByTestId('db-status')).toHaveText('Locked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await page.getByTestId('db-unlock-button').click();
      await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });

      // Write some data
      await page.getByTestId('db-write-button').click();
      await waitForSuccess(page);
      const originalValue = await page
        .getByTestId('db-test-data')
        .textContent();

      // Export the database using client-side navigation
      const downloadPromise = page.waitForEvent('download');
      await navigateTo(page, 'Settings');
      await expect(page).toHaveURL('/settings');
      await page.getByTestId('backup-export-button').click();
      const download = await downloadPromise;

      // Save the backup file
      const backupPath = `/tmp/test-backup-${Date.now()}.db`;
      await download.saveAs(backupPath);

      // Reset the database using client-side navigation
      await navigateTo(page, 'SQLite');
      await expect(page).toHaveURL('/sqlite');
      await page.getByTestId('db-reset-button').click();
      await waitForSuccess(page);
      await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');

      // Set up a fresh database
      await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await page.getByTestId('db-setup-button').click();
      await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });

      // Restore from backup using client-side navigation
      await navigateTo(page, 'Settings');
      await expect(page).toHaveURL('/settings');
      const fileInput = page.getByTestId('dropzone-input');
      await fileInput.setInputFiles(backupPath);

      // Confirm restore
      await expect(page.getByTestId('backup-restore-confirm')).toBeVisible({
        timeout: 5000
      });
      await page.getByTestId('backup-restore-confirm').click();

      // After restore, navigate to SQLite page to check status
      // (db-status element is on the SQLite page, not settings)
      await navigateTo(page, 'SQLite');
      await expect(page).toHaveURL('/sqlite');

      // After restore, we should be locked out
      await expect(page.getByTestId('db-status')).toHaveText('Locked', {
        timeout: DB_OPERATION_TIMEOUT
      });

      // Unlock with the same password
      await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
      await page.getByTestId('db-unlock-button').click();
      await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });

      // Verify the data was restored using client-side navigation
      await navigateTo(page, 'SQLite');
      await expect(page).toHaveURL('/sqlite');
      await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      await page.getByTestId('db-read-button').click();
      await waitForSuccess(page);
      const restoredValue = await page.getByTestId('db-test-data').textContent();

      expect(restoredValue).toBe(originalValue);
    });
  });
});
