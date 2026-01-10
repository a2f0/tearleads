import { test, expect, type Page } from '@playwright/test';

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to setup a new database with test password
const setupDatabase = async (page: Page) => {
  await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
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
const ensureUnlocked = async (page: Page) => {
  // Wait for status to stabilize (not "Not Set Up" which means still switching)
  await expect(page.getByTestId('db-status')).not.toHaveText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Wait a moment for React state to settle after instance switch
  await page.waitForTimeout(100);

  const status = await page.getByTestId('db-status').textContent();
  if (status === 'Locked') {
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });
  }
};

test.describe('Instance Switching State Isolation', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the SQLite page
    await page.goto('/sqlite');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Reset the database to ensure clean state
    const resetButton = page.getByTestId('db-reset-button');
    await resetButton.click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  test('DatabaseTest state resets when creating a new instance', async ({
    page
  }) => {
    // Setup first instance
    await setupDatabase(page);

    // Verify "Database setup complete" message
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Database setup complete'
    );

    // Create new instance via account switcher
    await createNewInstance(page);

    // Verify state is reset - element should either not exist (idle state has no message)
    // or not contain "Database setup complete"
    const resultElement = page.getByTestId('db-test-result');
    const isVisible = await resultElement.isVisible().catch(() => false);
    if (isVisible) {
      await expect(resultElement).not.toContainText('Database setup complete');
      const resultStatus = await resultElement.getAttribute('data-status');
      expect(resultStatus).toBe('idle');
    }
    // If not visible, that's correct - idle state has no message

    // Verify status shows "Not Set Up"
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  test('testData clears when switching instances', async ({ page }) => {
    // Setup first instance
    await setupDatabase(page);

    // Write test data
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    // Verify test data is displayed
    await expect(page.getByTestId('db-test-data')).toBeVisible();

    // Create new instance
    await createNewInstance(page);

    // testData should be cleared
    await expect(page.getByTestId('db-test-data')).not.toBeVisible();
  });

  test('switching back to original instance shows correct UI state', async ({
    page
  }) => {
    // Setup first instance
    await setupDatabase(page);

    // Create second instance
    await createNewInstance(page);

    // Setup second instance
    await setupDatabase(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Database setup complete'
    );

    // Switch back to first instance
    await switchToInstance(page, 0);

    // First instance should be unlocked (or locked if session expired)
    // Either way, it should NOT show "Not Set Up"
    await expect(page.getByTestId('db-status')).not.toHaveText('Not Set Up', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Wait for state to settle - the "Database setup complete" message should either:
    // 1. Not be visible (state reset to idle), OR
    // 2. Be replaced with a different message (e.g., "Session restored")
    // Use a more robust approach: wait for the specific problematic text to disappear
    await expect(page.getByTestId('db-test-result')).not.toContainText(
      'Database setup complete',
      { timeout: DB_OPERATION_TIMEOUT }
    );
  });

  test('each instance maintains independent state', async ({ page }) => {
    // Setup first instance
    await setupDatabase(page);
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    const firstInstanceData = await page
      .getByTestId('db-test-data')
      .textContent();

    // Create second instance
    await createNewInstance(page);

    // Second instance should be empty
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
    await expect(page.getByTestId('db-test-data')).not.toBeVisible();

    // Setup second instance
    await setupDatabase(page);
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    const secondInstanceData = await page
      .getByTestId('db-test-data')
      .textContent();

    // Data should be different (includes timestamp)
    expect(firstInstanceData).not.toBe(secondInstanceData);

    // Switch back to first instance and verify its data
    await switchToInstance(page, 0);

    // Ensure database is unlocked (it might be locked if session wasn't persisted)
    await ensureUnlocked(page);

    // Read data from first instance
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);

    // Verify it matches the original data
    await expect(page.getByTestId('db-test-data')).toHaveText(
      firstInstanceData!
    );
  });
});
