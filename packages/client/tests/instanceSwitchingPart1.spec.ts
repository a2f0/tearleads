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

    // The db-test-result element should not be visible after state reset
    // (idle state doesn't render the element at all)
    await expect(page.getByTestId('db-test-result')).not.toBeVisible();
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

// Helper to check if viewport is mobile (sidebar hidden at lg breakpoint = 1024px)
function isMobileViewport(page: Page): boolean {
  const viewport = page.viewportSize();
  return (viewport?.width ?? 0) < 1024;
}

// Map page names to routes
const PAGE_ROUTES = {
  SQLite: '/sqlite',
  Files: '/files'
} as const;

// Helper for in-app navigation that preserves React state (including current instance)
// Uses history.pushState + popstate event to trigger React Router navigation
// without a full page reload. This is critical for instance switching tests
// because page.goto() causes initializeRegistry() to reset to test-worker-N instance.
async function navigateInApp(page: Page, path: string) {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  // Give React time to process the navigation
  await page.waitForTimeout(500);
}

// Helper to unlock via inline unlock component if database is locked after page navigation
async function unlockIfNeeded(page: Page, password = TEST_PASSWORD): Promise<void> {
  // Wait for page to stabilize after navigation
  await page.waitForTimeout(500);

  const inlineUnlock = page.getByTestId('inline-unlock-password');
  if (await inlineUnlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inlineUnlock.fill(password);
    await page.getByTestId('inline-unlock-button').click();
    await expect(inlineUnlock).not.toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
  }
}

// Helper to navigate to a page, handling mobile/desktop differences
async function navigateToPage(page: Page, pageName: 'SQLite' | 'Files') {
  const isMobile = isMobileViewport(page);

  if (isMobile) {
    await page.getByTestId('mobile-menu-button').click();
    await page
      .getByTestId('mobile-menu-dropdown')
      .getByTestId(`${pageName.toLowerCase()}-link`)
      .click();
  } else {
    // Use in-app navigation to preserve React state (including current instance)
    // page.goto() would cause a full reload, resetting instance to test-worker-N
    const route = PAGE_ROUTES[pageName];
    await navigateInApp(page, route);
    await unlockIfNeeded(page);
  }
}

// Helper to upload a test file and wait for it to appear in the list
async function uploadTestFile(page: Page, fileName = 'test-image.png') {
  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: MINIMAL_PNG
  });

  // Wait for "1 file" text which confirms the upload completed
  await expect(page.getByText('1 file')).toBeVisible({ timeout: 60000 });
}

// Helper to setup database on the SQLite page (handles locked/unlocked states)
async function setupDatabaseOnSqlitePage(page: Page, useInAppNavigation = false) {
  if (useInAppNavigation) {
    // Use in-app navigation by directly modifying the URL hash/path
    // This preserves React state including the current instance
    await page.evaluate(() => {
      window.history.pushState({}, '', '/sqlite');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(500);
  } else {
    await navigateToPage(page, 'SQLite');
  }

  // Wait for status to stabilize (not Loading)
  await expect(page.getByTestId('db-status')).not.toHaveText('Loading...', {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Check the current database status
  const status = await page.getByTestId('db-status').textContent();

  if (status === 'Unlocked') {
    // Already unlocked, nothing to do
    return;
  }

  if (status === 'Locked') {
    // Database is locked, reset it first to get to "Not Set Up" state
    await page.getByTestId('db-reset-button').click();
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up', {
      timeout: DB_OPERATION_TIMEOUT
    });
  }

  // Now set up the database
  await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
  await page.getByTestId('db-setup-button').click();

  // Wait for the operation to complete (either success or error)
  const resultElement = page.getByTestId('db-test-result');
  await expect(resultElement).toHaveAttribute('data-status', /(success|error)/, {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Check if it was an error
  const resultStatus = await resultElement.getAttribute('data-status');
  if (resultStatus === 'error') {
    const errorText = await resultElement.textContent();
    throw new Error(`Database setup failed: ${errorText}`);
  }

  // Verify the database is now unlocked
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
}

// Helper to create a new instance while on any page
async function createNewInstanceFromAnyPage(page: Page) {
  await page.getByTestId('account-switcher-button').click();
  await expect(page.getByTestId('create-instance-button')).toBeVisible();
  await page.getByTestId('create-instance-button').click();

  // Wait for instance creation and OPFS registry write to complete
  // This is important because page.goto() will reload and read the registry
  await page.waitForTimeout(1000);
}

// Helper to switch to instance while on any page
async function switchToInstanceFromAnyPage(page: Page, instanceIndex: number) {
  await page.getByTestId('account-switcher-button').click();
  const instanceItems = page.locator(
    '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
  );
  await expect(instanceItems.nth(instanceIndex)).toBeVisible();
  await instanceItems.nth(instanceIndex).click();

  // Wait for the account switcher dropdown to close (indicates click was handled)
  await expect(page.getByTestId('create-instance-button')).not.toBeVisible();

  // Wait for the instance switch to complete (loading state to settle)
  await page.waitForTimeout(500);
}