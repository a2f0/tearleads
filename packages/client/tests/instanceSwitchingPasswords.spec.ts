/**
 * AGENT GUARDRAIL: Do NOT skip any tests in this file.
 * Instance switching tests are critical for verifying data isolation between instances.
 * If tests fail, fix the root cause rather than skipping.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './testUtils';

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
const setupDatabase = async (page: Page, password: string) => {
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
const ensureUnlocked = async (page: Page, password: string) => {
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

test.describe('Multi-Instance Password Isolation', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/sqlite');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Delete all other instances to ensure test isolation
    await deleteAllOtherInstances(page);

    // Reset the database to ensure clean state
    const resetButton = page.getByTestId('db-reset-button');
    await resetButton.click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  test('each instance can have a different password', async ({ page }) => {
    // Setup first instance with INSTANCE1_PASSWORD
    await setupDatabase(page, INSTANCE1_PASSWORD);
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    const firstInstanceData = await page
      .getByTestId('db-test-data')
      .textContent();
    expect(firstInstanceData).toBeTruthy();

    // Create and setup second instance with INSTANCE2_PASSWORD
    await createNewInstance(page);
    await setupDatabase(page, INSTANCE2_PASSWORD);
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    const secondInstanceData = await page
      .getByTestId('db-test-data')
      .textContent();
    expect(secondInstanceData).toBeTruthy();
    expect(firstInstanceData).not.toBe(secondInstanceData);

    // Switch back to first instance and verify it works with its password
    await switchToInstance(page, 0);
    await ensureUnlocked(page, INSTANCE1_PASSWORD);
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-data')).toHaveText(
      firstInstanceData!
    );
  });

  test('wrong password fails authentication on each instance', async ({
    page
  }) => {
    // Setup first instance with INSTANCE1_PASSWORD
    await setupDatabase(page, INSTANCE1_PASSWORD);

    // Create and setup second instance with INSTANCE2_PASSWORD
    await createNewInstance(page);
    await setupDatabase(page, INSTANCE2_PASSWORD);

    // Lock the second instance
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock second instance with first instance's password (wrong)
    await page.getByTestId('db-password-input').fill(INSTANCE1_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await waitForAuthError(page);

    // Verify still locked
    await expect(page.getByTestId('db-status')).toHaveText('Locked');

    // Now unlock correctly with second instance's password
    await page.getByTestId('db-password-input').fill(INSTANCE2_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Switch to first instance
    await switchToInstance(page, 0);

    // Wait for status to show Locked
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock first instance with second instance's password (wrong)
    await page.getByTestId('db-password-input').fill(INSTANCE2_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await waitForAuthError(page);

    // Verify still locked
    await expect(page.getByTestId('db-status')).toHaveText('Locked');

    // Now unlock correctly with first instance's password
    await page.getByTestId('db-password-input').fill(INSTANCE1_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });
  });

  test('data persists across page reload for each instance', async ({
    page
  }) => {
    // Setup first instance with INSTANCE1_PASSWORD and write data
    await setupDatabase(page, INSTANCE1_PASSWORD);
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const firstInstanceData = await page
      .getByTestId('db-test-data')
      .textContent();
    expect(firstInstanceData).toBeTruthy();

    // Create and setup second instance with INSTANCE2_PASSWORD
    await createNewInstance(page);
    await setupDatabase(page, INSTANCE2_PASSWORD);
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const secondInstanceData = await page
      .getByTestId('db-test-data')
      .textContent();
    expect(secondInstanceData).toBeTruthy();

    // Reload the page (simulates app restart for web)
    await page.reload();
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Should start on the last active instance (second instance)
    // It should be in Locked state
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock with second instance's password
    await page.getByTestId('db-password-input').fill(INSTANCE2_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read and verify second instance data
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-data')).toHaveText(
      secondInstanceData!
    );

    // Switch to first instance and verify its data also persisted
    await switchToInstance(page, 0);
    await ensureUnlocked(page, INSTANCE1_PASSWORD);

    // Read and verify first instance data
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-data')).toHaveText(
      firstInstanceData!
    );
  });
});
