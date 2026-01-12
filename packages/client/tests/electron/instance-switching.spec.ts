import {
  test,
  expect,
  ElectronApplication,
  Page
} from '@playwright/test';
import { launchElectronApp } from './electron-test-helper';

const INSTANCE1_PASSWORD = 'password-instance1!';
const INSTANCE2_PASSWORD = 'different-password2@';
const DB_OPERATION_TIMEOUT = 15000;
const APP_LOAD_TIMEOUT = 10000;

// Helper to wait for successful database operation
const waitForSuccess = (window: Page) =>
  expect(window.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to setup a new database with given password
const setupDatabase = async (window: Page, password: string) => {
  await window.getByTestId('db-password-input').fill(password);
  await window.getByTestId('db-setup-button').click();
  await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
};

// Helper to create a new instance via account switcher
const createNewInstance = async (window: Page) => {
  await window.getByTestId('account-switcher-button').click();
  await expect(window.getByTestId('create-instance-button')).toBeVisible();
  await window.getByTestId('create-instance-button').click();
  // Wait for the new instance to be active (database should be not set up)
  await expect(window.getByTestId('db-status')).toHaveText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });
};

// Helper to switch to a specific instance by index (0 = first instance)
const switchToInstance = async (window: Page, instanceIndex: number) => {
  await window.getByTestId('account-switcher-button').click();
  // Instance items have testid pattern: instance-{uuid}
  const instanceItems = window.locator(
    '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
  );
  await expect(instanceItems.nth(instanceIndex)).toBeVisible();
  await instanceItems.nth(instanceIndex).click();
};

// Helper to ensure database is unlocked (handles both locked and unlocked states)
const ensureUnlocked = async (window: Page, password: string) => {
  // Wait for status to stabilize (not "Not Set Up" which means still switching)
  await expect(window.getByTestId('db-status')).not.toHaveText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Wait a moment for React state to settle after instance switch
  await window.waitForTimeout(100);

  const status = await window.getByTestId('db-status').textContent();
  if (status === 'Locked') {
    await window.getByTestId('db-password-input').fill(password);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });
  }
};

// Helper to wait for authentication error
const waitForAuthError = (window: Page) =>
  expect(window.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'error',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to delete all instances except the current one (for test isolation)
const deleteAllOtherInstances = async (window: Page) => {
  // Open the account switcher to see all instances
  await window.getByTestId('account-switcher-button').click();
  await window.waitForTimeout(100);

  // Get all instance items (excluding icons and delete buttons)
  const instanceItems = window.locator(
    '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
  );
  const count = await instanceItems.count();

  // Close the switcher
  await window.keyboard.press('Escape');
  await window.waitForTimeout(100);

  // If there's more than one instance, delete the extras
  if (count > 1) {
    // Delete instances from the end to avoid index shifting issues
    for (let i = count - 1; i >= 1; i--) {
      // Open switcher
      await window.getByTestId('account-switcher-button').click();
      await window.waitForTimeout(100);

      // Get the delete button for instance at index i
      const items = window.locator(
        '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
      );
      const instanceId = await items
        .nth(i)
        .getAttribute('data-testid')
        .then((id) => id?.replace('instance-', ''));

      if (instanceId) {
        const deleteButton = window.getByTestId(`delete-instance-${instanceId}`);
        await deleteButton.click();

        // Wait for and confirm the delete dialog
        await expect(
          window.getByTestId('delete-instance-dialog')
        ).toBeVisible();
        await window.getByRole('button', { name: 'Delete' }).click();

        // Wait for dialog to close
        await expect(
          window.getByTestId('delete-instance-dialog')
        ).not.toBeVisible();
      }
    }
  }
};

test.describe('Instance Switching (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(
      window.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Navigate to SQLite page via sidebar (visible on desktop)
    await window.locator('nav').getByRole('link', { name: 'SQLite' }).click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Delete all other instances to ensure test isolation
    await deleteAllOtherInstances(window);

    // Reset the database to ensure clean state
    const resetButton = window.getByTestId('db-reset-button');
    await resetButton.click();
    await waitForSuccess(window);
    await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('state resets when creating a new instance', async () => {
    // Setup first instance with its password
    await setupDatabase(window, INSTANCE1_PASSWORD);

    // Verify "Database setup complete" message
    await expect(window.getByTestId('db-test-result')).toContainText(
      'Database setup complete'
    );

    // Create new instance via account switcher
    await createNewInstance(window);

    // Verify state is reset - element should either not exist (idle state has no message)
    // or not contain "Database setup complete"
    const resultElement = window.getByTestId('db-test-result');
    const isVisible = await resultElement.isVisible().catch(() => false);
    if (isVisible) {
      await expect(resultElement).not.toContainText('Database setup complete');
      const resultStatus = await resultElement.getAttribute('data-status');
      expect(resultStatus).toBe('idle');
    }
    // If not visible, that's correct - idle state has no message

    // Verify status shows "Not Set Up"
    await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  test('test data clears when switching instances', async () => {
    // Setup first instance with its password
    await setupDatabase(window, INSTANCE1_PASSWORD);

    // Write test data
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);

    // Verify test data is displayed
    await expect(window.getByTestId('db-test-data')).toBeVisible();

    // Create new instance
    await createNewInstance(window);

    // testData should be cleared
    await expect(window.getByTestId('db-test-data')).not.toBeVisible();
  });

  test('switching back to original instance shows correct UI state', async () => {
    // Setup first instance with its password
    await setupDatabase(window, INSTANCE1_PASSWORD);

    // Create second instance
    await createNewInstance(window);

    // Setup second instance with different password
    await setupDatabase(window, INSTANCE2_PASSWORD);
    await expect(window.getByTestId('db-test-result')).toContainText(
      'Database setup complete'
    );

    // Switch back to first instance
    await switchToInstance(window, 0);

    // First instance should be unlocked (or locked if session expired)
    // Either way, it should NOT show "Not Set Up"
    await expect(window.getByTestId('db-status')).not.toHaveText('Not Set Up', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // The db-test-result element should not be visible after state reset
    // (idle state doesn't render the element at all)
    await expect(window.getByTestId('db-test-result')).not.toBeVisible();
  });

  test('each instance maintains independent state', async () => {
    // Setup first instance with its password
    await setupDatabase(window, INSTANCE1_PASSWORD);
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);

    const firstInstanceData = await window
      .getByTestId('db-test-data')
      .textContent();

    // Create second instance
    await createNewInstance(window);

    // Second instance should be empty
    await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');
    await expect(window.getByTestId('db-test-data')).not.toBeVisible();

    // Setup second instance with different password
    await setupDatabase(window, INSTANCE2_PASSWORD);
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);

    const secondInstanceData = await window
      .getByTestId('db-test-data')
      .textContent();

    // Data should be different (includes timestamp)
    expect(firstInstanceData).not.toBe(secondInstanceData);

    // Switch back to first instance and verify its data
    await switchToInstance(window, 0);

    // Ensure database is unlocked with first instance's password
    await ensureUnlocked(window, INSTANCE1_PASSWORD);

    // Read data from first instance
    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);

    // Verify it matches the original data
    await expect(window.getByTestId('db-test-data')).toHaveText(
      firstInstanceData!
    );
  });

  test('data persists across app restarts for each instance', async () => {
    // Setup first instance with its password and write data
    await setupDatabase(window, INSTANCE1_PASSWORD);
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const firstInstanceData = await window
      .getByTestId('db-test-data')
      .textContent();

    // Create and setup second instance with different password
    await createNewInstance(window);
    await setupDatabase(window, INSTANCE2_PASSWORD);
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const secondInstanceData = await window
      .getByTestId('db-test-data')
      .textContent();

    // Close and relaunch the app
    await electronApp.close();
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(
      window.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Navigate to SQLite page
    await window.locator('nav').getByRole('link', { name: 'SQLite' }).click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Should start on the last active instance (second instance)
    // It should be in Locked state
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock with second instance's password
    await window.getByTestId('db-password-input').fill(INSTANCE2_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read and verify second instance data
    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);
    await expect(window.getByTestId('db-test-data')).toHaveText(
      secondInstanceData!
    );

    // Switch to first instance
    await switchToInstance(window, 0);
    await ensureUnlocked(window, INSTANCE1_PASSWORD);

    // Read and verify first instance data
    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);
    await expect(window.getByTestId('db-test-data')).toHaveText(
      firstInstanceData!
    );
  });

  test('wrong password fails authentication on each instance', async () => {
    // Setup first instance with its password
    await setupDatabase(window, INSTANCE1_PASSWORD);

    // Create and setup second instance with different password
    await createNewInstance(window);
    await setupDatabase(window, INSTANCE2_PASSWORD);

    // Lock the second instance
    await window.getByTestId('db-lock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock second instance with first instance's password (wrong)
    await window.getByTestId('db-password-input').fill(INSTANCE1_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await waitForAuthError(window);

    // Verify still locked
    await expect(window.getByTestId('db-status')).toHaveText('Locked');

    // Now unlock correctly with second instance's password
    await window.getByTestId('db-password-input').fill(INSTANCE2_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Switch to first instance
    await switchToInstance(window, 0);

    // Wait for status to show Locked
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock first instance with second instance's password (wrong)
    await window.getByTestId('db-password-input').fill(INSTANCE2_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await waitForAuthError(window);

    // Verify still locked
    await expect(window.getByTestId('db-status')).toHaveText('Locked');

    // Now unlock correctly with first instance's password
    await window.getByTestId('db-password-input').fill(INSTANCE1_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });
  });
});
