/**
 * AGENT GUARDRAIL: Do NOT skip any tests in this file.
 * Instance switching tests are critical for verifying data isolation between instances.
 * If tests fail, fix the root cause rather than skipping.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage, MINIMAL_PNG } from './testUtils';

const TEST_PASSWORD = 'testpassword123';
const INSTANCE1_PASSWORD = 'password-instance1!';
const INSTANCE2_PASSWORD = 'different-password2@';
const DB_OPERATION_TIMEOUT = 15000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to setup a new database with test password
const setupDatabase = async (page: Page, password = TEST_PASSWORD) => {
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
};

// Helper to create a new instance via account switcher
const createNewInstance = async (page: Page) => {
  await page.getByTestId('account-switcher-button').click();
  await expect(page.getByTestId('create-instance-button')).toBeVisible();
  await page.getByTestId('create-instance-button').click();
  // Wait for the new instance to be active (database should be not set up)
  await expect(page.getByTestId('db-status')).toHaveText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });
};

// Helper to switch to a specific instance by index (0 = first instance)
const switchToInstance = async (page: Page, instanceIndex: number) => {
  await page.getByTestId('account-switcher-button').click();
  // Instance items have testid pattern: instance-{uuid}
  const instanceItems = page.locator(
    '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
  );
  await expect(instanceItems.nth(instanceIndex)).toBeVisible();
  await instanceItems.nth(instanceIndex).click();
};

// Helper to ensure database is unlocked (handles both locked and unlocked states)
const ensureUnlocked = async (page: Page, password = TEST_PASSWORD) => {
  // Wait for status to stabilize (not "Not Set Up" which means still switching)
  await expect(page.getByTestId('db-status')).not.toHaveText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Wait a moment for React state to settle after instance switch
  await page.waitForTimeout(100);

  const status = await page.getByTestId('db-status').textContent();
  if (status === 'Locked') {
    await page.getByTestId('db-password-input').fill(password);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });
  }
};

// Helper to wait for authentication error
const waitForAuthError = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'error',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to delete all instances except the current one (for test isolation)
const deleteAllOtherInstances = async (page: Page) => {
  // Open the account switcher to see all instances
  await page.getByTestId('account-switcher-button').click();
  await page.waitForTimeout(100);

  // Get all instance items (excluding icons and delete buttons)
  const instanceItems = page.locator(
    '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
  );
  const count = await instanceItems.count();

  // Close the switcher
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // If there's more than one instance, delete the extras
  if (count > 1) {
    // Delete instances from the end to avoid index shifting issues
    for (let i = count - 1; i >= 1; i--) {
      // Open switcher
      await page.getByTestId('account-switcher-button').click();
      await page.waitForTimeout(100);

      // Get the delete button for instance at index i
      const items = page.locator(
        '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
      );
      const instanceId = await items
        .nth(i)
        .getAttribute('data-testid')
        .then((id) => id?.replace('instance-', ''));

      if (instanceId) {
        const deleteButton = page.getByTestId(`delete-instance-${instanceId}`);
        await deleteButton.click();

        // Wait for and confirm the delete dialog
        await expect(
          page.getByTestId('delete-instance-dialog')
        ).toBeVisible();
        await page.getByRole('button', { name: 'Delete' }).click();

        // Wait for dialog to close
        await expect(
          page.getByTestId('delete-instance-dialog')
        ).not.toBeVisible();
      }
    }
  }
};

// Helper to maximize any floating window if present
async function maximizeFloatingWindowIfPresent(page: Page) {
  const maximizeButton = page.getByRole('button', { name: /^Maximize/ });
  if (await maximizeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await maximizeButton.click();
  }
}

// Helper to click the refresh button on the files page
// TODO: Automatic refresh has a race condition - investigate worker timing
async function forceRefreshFiles(page: Page) {
  await page.waitForTimeout(500);
  const refreshButton = page.getByRole('button', { name: 'Refresh' });
  await refreshButton.click();
}

test.describe('Files Route Instance Switching', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh by going to SQLite and resetting
    await clearOriginStorage(page);
    await page.goto('/sqlite');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Delete all other instances to ensure test isolation
    // (instances from previous test runs may persist)
    await deleteAllOtherInstances(page);

    const resetButton = page.getByTestId('db-reset-button');
    await resetButton.click();
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  // AGENT GUARDRAIL: Do NOT skip this test. Instance switching tests are critical for data isolation.
  // If this test fails, fix the root cause rather than skipping.
  test('files page refreshes when switching to empty instance', async ({
    page
  }) => {
    test.slow(); // File upload and thumbnail generation can be slow

    // Setup first instance and upload a file
    await setupDatabaseOnSqlitePage(page);
    await navigateToPage(page, 'Files');
    await uploadTestFile(page);

    // Verify file is visible
    await expect(page.getByText('test-image.png')).toBeVisible();

    // Create new instance (should switch to it automatically)
    await createNewInstanceFromAnyPage(page);

    // Wait for the InlineUnlock component to appear (new instance not set up)
    // The text shows "Database is not set up" for new instances
    await expect(
      page.getByText('Database is not set up')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });

    // Set up the new instance via SQLite page
    // Use in-app navigation to preserve React state during setup
    await setupDatabaseOnSqlitePage(page, true);

    // Go back to Files page
    await navigateToPage(page, 'Files');

    // Wait for empty state
    await expect(
      page.getByText('No files found. Drop or select files above to upload.')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });

    // Verify the old file is NOT visible (isolated data)
    await expect(page.getByText('test-image.png')).not.toBeVisible();
  });

  // AGENT GUARDRAIL: Do NOT skip this test. Instance switching tests are critical for data isolation.
  // If this test fails, fix the root cause rather than skipping.
  test('files page loads correct files when switching back to original instance', async ({
    page
  }) => {
    test.slow();

    // Setup first instance and upload a file
    await setupDatabaseOnSqlitePage(page);
    await navigateToPage(page, 'Files');
    await uploadTestFile(page, 'instance1-file.png');
    await expect(page.getByText('instance1-file.png')).toBeVisible();

    // Create second instance
    await createNewInstanceFromAnyPage(page);

    // Verify two instances exist after creating the second one
    await page.getByTestId('account-switcher-button').click();
    const instancesAfterCreate = page.locator(
      '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
    );
    await expect(instancesAfterCreate).toHaveCount(2, { timeout: DB_OPERATION_TIMEOUT });
    await page.keyboard.press('Escape');

    // New instance is not set up, so we need to set it up via SQLite page
    await expect(
      page.getByText('Database is not set up')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });

    // Use in-app navigation for second instance to preserve React state
    // (page.goto() causes a full reload that reads registry which can have timing issues)
    await setupDatabaseOnSqlitePage(page, true);

    // Checkpoint: verify 2 instances AFTER setupDatabaseOnSqlitePage
    await page.getByTestId('account-switcher-button').click();
    await expect(instancesAfterCreate).toHaveCount(2, { timeout: 5000 });
    await page.keyboard.press('Escape');

    await navigateToPage(page, 'Files');

    // Wait for empty state
    await expect(
      page.getByText('No files found. Drop or select files above to upload.')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });

    // Upload different file to second instance
    await uploadTestFile(page, 'instance2-file.png');
    await expect(page.getByText('instance2-file.png')).toBeVisible();
    await expect(page.getByText('instance1-file.png')).not.toBeVisible();

    // Verify we have two instances before switching
    await page.getByTestId('account-switcher-button').click();
    const instanceItems = page.locator(
      '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
    );
    await expect(instanceItems).toHaveCount(2);

    // Click the first instance (index 0)
    await instanceItems.first().click();

    // Wait for the dropdown to close and state to settle
    await expect(page.getByTestId('create-instance-button')).not.toBeVisible();
    await page.waitForTimeout(1000);

    // Navigate away and back to force a fresh page load for the new instance
    await page.goto('/');
    await page.waitForTimeout(500);
    await page.goto('/files');

    // Wait for state to settle, unlock if needed
    await page.waitForTimeout(500);
    await unlockIfNeeded(page);
    await forceRefreshFiles(page);

    // Verify first instance file is now visible (this is the key test!)
    await expect(page.getByText('instance1-file.png')).toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });
    // And second instance file is NOT visible (already checked above, but verify again)
    await expect(page.getByText('instance2-file.png')).not.toBeVisible();
  });

  // AGENT GUARDRAIL: Do NOT skip this test. Instance switching tests are critical for data isolation.
  // If this test fails, fix the root cause rather than skipping.
  test('thumbnails load after switching instances', async ({ page }) => {
    test.slow();

    // Setup first instance and upload a file
    await setupDatabaseOnSqlitePage(page);
    await navigateToPage(page, 'Files');
    await uploadTestFile(page);

    // Wait for thumbnail to load (img element should be visible)
    await expect(page.locator('img[alt=""]').first()).toBeVisible({
      timeout: 30000
    });

    // Create second instance
    await createNewInstanceFromAnyPage(page);

    // New instance is not set up, so we need to set it up via SQLite page
    await expect(
      page.getByText('Database is not set up')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
    // Use in-app navigation to preserve React state during setup
    await setupDatabaseOnSqlitePage(page, true);
    await navigateToPage(page, 'Files');

    // Upload file to second instance
    await expect(
      page.getByText('No files found. Drop or select files above to upload.')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
    await uploadTestFile(page, 'second-instance-image.png');

    // Verify thumbnail loads for second instance file
    await expect(page.locator('img[alt=""]').first()).toBeVisible({
      timeout: 30000
    });

    // Switch back to first instance
    await switchToInstanceFromAnyPage(page, 0);

    // Maximize floating window if present (files may open in small window)
    await maximizeFloatingWindowIfPresent(page);

    // Wait for instance switch to complete - the second instance's file should disappear
    await expect(page.getByText('second-instance-image.png')).not.toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });

    // Wait for the locked state (first instance should be locked)
    const inlineUnlock = page.getByTestId('inline-unlock');
    await expect(inlineUnlock).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });

    // Unlock the first instance's database
    const inlineUnlockPassword = page.getByTestId('inline-unlock-password');
    await inlineUnlockPassword.fill(TEST_PASSWORD);
    await page.getByTestId('inline-unlock-button').click();

    // Wait for unlock to complete
    await expect(inlineUnlockPassword).not.toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });

    // Force refresh to ensure files are loaded
    await forceRefreshFiles(page);

    // Verify thumbnail loads for first instance (key assertion)
    await expect(page.getByText('test-image.png')).toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });
    await expect(page.locator('img[alt=""]').first()).toBeVisible({
      timeout: 30000
    });
  });
});