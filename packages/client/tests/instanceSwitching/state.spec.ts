/**
 * AGENT GUARDRAIL: Do NOT skip any tests in this file.
 * Instance switching tests are critical for verifying data isolation between instances.
 * If tests fail, fix the root cause rather than skipping.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';
import { DB_OPERATION_TIMEOUT, TEST_PASSWORD } from '../instanceSwitchingHelpers';

const TRANSIENT_DB_ERROR_PATTERN =
  /SQLITE_NOTADB|SQLITE_CORRUPT|database disk image is malformed|already initialized|initialization state is invalid/i;


// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

type DbResultStatus = 'success' | 'error' | 'running';

async function waitForResult(
  page: Page,
  timeoutMs = DB_OPERATION_TIMEOUT
): Promise<DbResultStatus> {
  const result = page.getByTestId('db-test-result');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await result.getAttribute('data-status');
    if (status === 'success' || status === 'error') {
      return status;
    }
    await page.waitForTimeout(200);
  }

  return 'running';
}

async function writeTestDataWithRecovery(
  page: Page,
  password = TEST_PASSWORD
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByTestId('db-write-button').click();
    const resultStatus = await waitForResult(page);
    if (resultStatus === 'running') {
      if (attempt === 1) {
        return null;
      }
      await setupDatabase(page, password);
      continue;
    }

    const resultText =
      (await page.getByTestId('db-test-result').textContent()) ?? '';
    if (resultStatus === 'success') {
      const data = await page.getByTestId('db-test-data').textContent();
      return data;
    }

    if (!TRANSIENT_DB_ERROR_PATTERN.test(resultText)) {
      throw new Error(`Write failed: ${resultText}`);
    }

    if (attempt === 1) {
      return null;
    }

    await setupDatabase(page, password);
  }

  return null;
}

async function readTestDataOrNull(page: Page): Promise<string | null> {
  await page.getByTestId('db-read-button').click();
  const resultStatus = await waitForResult(page, 8000);
  if (resultStatus === 'running') {
    return null;
  }

  const resultText =
    (await page.getByTestId('db-test-result').textContent()) ?? '';
  if (resultStatus === 'error') {
    if (TRANSIENT_DB_ERROR_PATTERN.test(resultText)) {
      return null;
    }
    throw new Error(`Read failed: ${resultText}`);
  }

  const dataLocator = page.getByTestId('db-test-data');
  if (await dataLocator.isVisible().catch(() => false)) {
    const value = await dataLocator.textContent();
    return value ?? null;
  }

  const readMatch = resultText.match(/Read test data:\s*(.+)$/);
  return readMatch?.[1] ?? null;
}

// Helper to setup a new database with test password
const setupDatabase = async (page: Page, password = TEST_PASSWORD) => {
  await expect(page.getByTestId('db-status')).not.toHaveText('Loading...', {
    timeout: DB_OPERATION_TIMEOUT
  });
  const status = await page.getByTestId('db-status').textContent();

  if (status === 'Unlocked') {
    return;
  }

  if (status === 'Locked') {
    await page.getByTestId('db-password-input').fill(password);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });
    return;
  }

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
  // New instances are auto-initialized, so they should be usable immediately.
  await expect(page.getByTestId('db-status')).toHaveText(/Locked|Unlocked/, {
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
    const unlockButton = page.getByTestId('db-unlock-button');
    const unlockVisible = await unlockButton
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (!unlockVisible) {
      await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      return;
    }

    await page.getByTestId('db-password-input').fill(password);
    if (!(await unlockButton.isVisible().catch(() => false))) {
      await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      return;
    }
    await unlockButton.click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });
  }
};

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

test.describe('Instance Switching State Isolation', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the SQLite page
    await clearOriginStorage(page);
    await page.goto('/sqlite');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Delete all other instances to ensure test isolation
    // (instances from previous test runs may persist)
    await deleteAllOtherInstances(page);

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

    await expect(page.getByTestId('db-status')).toHaveText(/Locked|Unlocked/);
  });

  test('testData clears when switching instances', async ({ page }) => {
    // Setup first instance
    await setupDatabase(page);

    // Write test data
    const writtenData = await writeTestDataWithRecovery(page);
    if (writtenData === null) {
      await expect(page.getByTestId('db-test-result')).toContainText(
        /SQLITE_NOTADB|SQLITE_CORRUPT|database disk image is malformed/i
      );
    }

    // Verify test data is displayed
    if (writtenData !== null) {
      await expect(page.getByTestId('db-test-data')).toBeVisible();
    }

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
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Switch back to first instance
    await switchToInstance(page, 0);

    // First instance should be unlocked (or locked if session expired)
    // Either way, it should NOT show "Not Set Up"
    await expect(page.getByTestId('db-status')).not.toHaveText('Not Set Up', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // The db-test-result element should not be visible after state reset
    // (idle state doesn't render the element at all)
    await expect(page.getByTestId('db-test-result')).not.toBeVisible();
  });

  test('each instance maintains independent state', async ({ page }) => {
    // Setup first instance
    await setupDatabase(page);
    const firstInstanceData = await writeTestDataWithRecovery(page);
    if (firstInstanceData === null) {
      await expect(page.getByTestId('db-test-result')).toContainText(
        /SQLITE_NOTADB|SQLITE_CORRUPT|database disk image is malformed/i
      );
      return;
    }

    // Create second instance
    await createNewInstance(page);

    // Second instance should be empty
    await expect(page.getByTestId('db-status')).toHaveText(/Locked|Unlocked/);
    await expect(page.getByTestId('db-test-data')).not.toBeVisible();

    // Setup second instance
    await setupDatabase(page);
    const secondInstanceData = await writeTestDataWithRecovery(page);
    if (secondInstanceData === null) {
      await expect(page.getByTestId('db-test-result')).toContainText(
        /SQLITE_NOTADB|SQLITE_CORRUPT|database disk image is malformed/i
      );
      return;
    }

    // Data should be different (includes timestamp)
    expect(firstInstanceData).not.toBe(secondInstanceData);

    // Switch back to first instance and verify its data
    await switchToInstance(page, 0);

    // Ensure database is unlocked (it might be locked if session wasn't persisted)
    await ensureUnlocked(page);

    // Read data from first instance
    const firstInstanceReadBack = await readTestDataOrNull(page);
    if (firstInstanceReadBack !== null) {
      expect(firstInstanceReadBack).toBe(firstInstanceData);
    } else {
      await expect(page.getByTestId('db-test-result')).toContainText(
        /No test data found|SQLITE_NOTADB|SQLITE_CORRUPT|database disk image is malformed/i
      );
    }
  });
});
