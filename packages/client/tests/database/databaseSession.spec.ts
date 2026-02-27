import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;

const maybeEnableOpfsDebugLogs = async (page: Page) => {
  if (!process.env['OPFS_DEBUG_LOGS']) return;

  page.on('console', (msg) => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    console.log(`[browser:error] ${err.message}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('sqlite3-opfs-async-proxy.js')) {
      console.log(
        `[browser:requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`
      );
    }
  });
  page.on('requestfinished', (request) => {
    if (request.url().includes('sqlite3-opfs-async-proxy.js')) {
      console.log(`[browser:requestfinished] ${request.url()}`);
    }
  });

  const browserInfo = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    isSecureContext: self.isSecureContext === true,
    serviceWorkerController: !!navigator.serviceWorker?.controller
  }));
  console.log(`[browser:info] ${JSON.stringify(browserInfo)}`);
};

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

test.describe('Session Persistence (Web)', () => {
  test.beforeEach(async ({ page }) => {
    await maybeEnableOpfsDebugLogs(page);

    // Navigate to the SQLite page where database test UI is located
    await clearOriginStorage(page);
    await page.goto('/sqlite');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Reset the database to ensure clean state
    const resetButton = page.getByTestId('db-reset-button');
    await resetButton.click();

    // Wait for reset to complete
    await waitForSuccess(page);

    // Verify database is in "Not Set Up" state
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  test('should show persist checkbox and session status on web', async ({
    page
  }) => {
    // Setup database first
    await setupDatabase(page);

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify persist checkbox is visible
    const persistCheckbox = page.getByTestId('db-persist-checkbox');
    await expect(persistCheckbox).toBeVisible();
    await expect(persistCheckbox).not.toBeChecked();

    // Verify session status shows "No"
    await expect(page.getByTestId('db-session-status')).toHaveText('No');
  });

  test('should persist session when checkbox is checked', async ({ page }) => {
    // Setup database first
    await setupDatabase(page);

    // Write some data
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const writtenValue = await page.getByTestId('db-test-data').textContent();

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Check the persist checkbox
    const persistCheckbox = page.getByTestId('db-persist-checkbox');
    await persistCheckbox.check();
    await expect(persistCheckbox).toBeChecked();

    // Unlock with persist enabled
    await page.getByTestId('db-unlock-button').click();
    await waitForSuccess(page);

    // Verify session is now persisted
    await expect(page.getByTestId('db-session-status')).toHaveText('Yes');
    await expect(page.getByTestId('db-test-result')).toContainText(
      'session persisted'
    );

    // Verify data is still accessible
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);
    const readValue = await page.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });

  test('should auto-restore session on page reload', async ({ page }) => {
    // Setup database first
    await setupDatabase(page);

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Check the persist checkbox and unlock
    await page.getByTestId('db-persist-checkbox').check();
    await page.getByTestId('db-unlock-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-session-status')).toHaveText('Yes');

    // Reload the page (no need to lock first - session should persist)
    await page.reload();
    await expect(page.getByTestId('database-test')).toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });

    // Database should be automatically unlocked after reload
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Session should still be persisted
    await expect(page.getByTestId('db-session-status')).toHaveText('Yes', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify we can write new data (proves the database is functional)
    const writeButton = page.getByTestId('db-write-button');
    await expect(writeButton).toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
    await writeButton.click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrote test data:'
    );
  });

  test('should persist data across page reloads with OPFS', async ({ page }) => {
    // Setup database first
    await setupDatabase(page);

    // Write data BEFORE enabling session persistence
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const writtenValue = await page.getByTestId('db-test-data').textContent();

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Enable session persistence and unlock
    await page.getByTestId('db-persist-checkbox').check();
    await page.getByTestId('db-unlock-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-session-status')).toHaveText('Yes');

    // Reload the page (hard refresh)
    await page.reload();
    await expect(page.getByTestId('database-test')).toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });

    // Database should be automatically unlocked
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read the data - it should persist across reload via OPFS
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);
    const readValue = await page.getByTestId('db-test-data').textContent();

    // Verify the data persisted across the reload
    expect(readValue).toBe(writtenValue);
  });

  test('should clear session when locking with clear option', async ({
    page
  }) => {
    // Setup database first
    await setupDatabase(page);

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Check the persist checkbox and unlock
    await page.getByTestId('db-persist-checkbox').check();
    await page.getByTestId('db-unlock-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-session-status')).toHaveText('Yes');

    // Lock & Clear Session button should be visible
    const lockClearButton = page.getByTestId('db-lock-clear-session-button');
    await expect(lockClearButton).toBeVisible();

    // Click Lock & Clear Session
    await lockClearButton.click();
    await waitForSuccess(page);

    // Verify session is cleared
    await expect(page.getByTestId('db-session-status')).toHaveText('No');
    await expect(page.getByTestId('db-test-result')).toContainText(
      'session cleared'
    );

    // Restore Session button should NOT be visible
    await expect(
      page.getByTestId('db-restore-session-button')
    ).not.toBeVisible();
  });

  test('should clear session on database reset', async ({ page }) => {
    // Setup database first
    await setupDatabase(page);

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Check the persist checkbox and unlock
    await page.getByTestId('db-persist-checkbox').check();
    await page.getByTestId('db-unlock-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-session-status')).toHaveText('Yes');

    // Reset the database
    await page.getByTestId('db-reset-button').click();
    await waitForSuccess(page);

    // Verify session is cleared
    await expect(page.getByTestId('db-session-status')).toHaveText('No');

    // Verify database is in "Not Set Up" state
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
  });

  test('should not show restore button when no persisted session', async ({
    page
  }) => {
    // Setup database first
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Lock the database without persisting
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify session status shows "No"
    await expect(page.getByTestId('db-session-status')).toHaveText('No');

    // Restore Session button should NOT be visible
    await expect(
      page.getByTestId('db-restore-session-button')
    ).not.toBeVisible();
  });
});
