import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage, MINIMAL_PNG } from './test-utils';

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

// Helper to open sidebar via Start button (desktop only)
async function openSidebar(page: Page) {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await startButton.click();
  await expect(page.locator('aside nav')).toBeVisible({ timeout: 10000 });
}

// Map page names to routes
const PAGE_ROUTES: Record<string, string> = {
  SQLite: '/sqlite',
  Files: '/files'
};

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
    // Use URL navigation for page testing on desktop
    const route = PAGE_ROUTES[pageName];
    await page.goto(route);
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

// Helper to setup database on the SQLite page
async function setupDatabaseOnSqlitePage(page: Page) {
  await navigateToPage(page, 'SQLite');
  await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
}

// Helper to create a new instance while on any page
async function createNewInstanceFromAnyPage(page: Page) {
  await page.getByTestId('account-switcher-button').click();
  await expect(page.getByTestId('create-instance-button')).toBeVisible();
  await page.getByTestId('create-instance-button').click();
}

// Helper to switch to instance while on any page
async function switchToInstanceFromAnyPage(page: Page, instanceIndex: number) {
  await page.getByTestId('account-switcher-button').click();
  const instanceItems = page.locator(
    '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
  );
  await expect(instanceItems.nth(instanceIndex)).toBeVisible();
  await instanceItems.nth(instanceIndex).click();
}

// Helper to unlock on the current page if it's locked
async function unlockOnPageIfLocked(page: Page) {
  const passwordInput = page.getByPlaceholder('Password');
  if (await passwordInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await passwordInput.fill(TEST_PASSWORD);
    const unlockButton = page.getByRole('button', { name: 'Unlock' });
    if (await unlockButton.isVisible()) {
      await unlockButton.click();
    }
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
    await setupDatabaseOnSqlitePage(page);

    // Go back to Files page
    await navigateToPage(page, 'Files');

    // Wait for empty state
    await expect(
      page.getByText('No files found. Drop or select files above to upload.')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });

    // Verify the old file is NOT visible (isolated data)
    await expect(page.getByText('test-image.png')).not.toBeVisible();
  });

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

    // New instance is not set up, so we need to set it up via SQLite page
    await expect(
      page.getByText('Database is not set up')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
    await setupDatabaseOnSqlitePage(page);
    await navigateToPage(page, 'Files');

    // Wait for empty state
    await expect(
      page.getByText('No files found. Drop or select files above to upload.')
    ).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });

    // Upload different file to second instance
    await uploadTestFile(page, 'instance2-file.png');
    await expect(page.getByText('instance2-file.png')).toBeVisible();
    await expect(page.getByText('instance1-file.png')).not.toBeVisible();

    // Switch back to first instance
    await switchToInstanceFromAnyPage(page, 0);

    // Wait for state to settle, unlock if needed, and force refresh
    await page.waitForTimeout(500);
    await unlockOnPageIfLocked(page);
    await forceRefreshFiles(page);

    // Verify first instance file is now visible (this is the key test!)
    await expect(page.getByText('instance1-file.png')).toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });
    // And second instance file is NOT visible
    await expect(page.getByText('instance2-file.png')).not.toBeVisible();
  });

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
    await setupDatabaseOnSqlitePage(page);
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

    // Wait for state to settle, unlock if needed, and force refresh
    await page.waitForTimeout(500);
    await unlockOnPageIfLocked(page);
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
