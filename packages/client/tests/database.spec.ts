import { test, expect, type Page } from '@playwright/test';
import { clearOriginStorage } from './test-utils';

const TEST_PASSWORD = 'testpassword123';
const NEW_PASSWORD = 'newpassword456';
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

// Helper to wait for failed database operation
const waitForError = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'error',
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

// Requirements for web database tests:
// - Browser: Chrome 102+, Edge 102+, Firefox 111+, or Safari 15.2+
// - Headers: Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp
// - Playwright must launch Chrome with --enable-features=SharedArrayBuffer

test.describe('Database (Web)', () => {
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

  test('should setup a new database with password', async ({ page }) => {
    // Enter password
    const passwordInput = page.getByTestId('db-password-input');
    await passwordInput.fill(TEST_PASSWORD);

    // Click setup button
    const setupButton = page.getByTestId('db-setup-button');
    await expect(setupButton).toBeVisible();
    await setupButton.click();

    // Wait for setup to complete
    await waitForSuccess(page);

    // Verify database is now unlocked
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Database setup complete'
    );
  });

  test('should write and read data from database', async ({ page }) => {
    // Setup database first
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write data
    const writeButton = page.getByTestId('db-write-button');
    await expect(writeButton).toBeVisible();
    await writeButton.click();

    // Wait for write to complete
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrote test data:'
    );

    // Verify test data is displayed
    await expect(page.getByTestId('db-test-data')).toBeVisible();
    const writtenValue = await page.getByTestId('db-test-data').textContent();
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    // Read data
    const readButton = page.getByTestId('db-read-button');
    await readButton.click();

    // Wait for read to complete
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Read test data:'
    );

    // Verify the read value matches the written value
    const readValue = await page.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });

  test('should lock and unlock database', async ({ page }) => {
    // Setup database first
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Lock the database
    const lockButton = page.getByTestId('db-lock-button');
    await expect(lockButton).toBeVisible();
    await lockButton.click();

    // Wait for lock to complete
    await waitForSuccess(page);

    // Verify database is now locked
    await expect(page.getByTestId('db-status')).toHaveText('Locked');

    // Unlock the database
    const unlockButton = page.getByTestId('db-unlock-button');
    await expect(unlockButton).toBeVisible();
    await unlockButton.click();

    // Wait for unlock to complete
    await waitForSuccess(page);

    // Verify database is unlocked again
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
  });

  test('should fail to unlock with wrong password', async ({ page }) => {
    // Setup database first
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock with wrong password
    await page.getByTestId('db-password-input').fill('wrongpassword');
    await page.getByTestId('db-unlock-button').click();

    // Wait for unlock attempt to complete
    await waitForError(page);

    // Verify error message
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrong password'
    );

    // Verify database is still locked
    await expect(page.getByTestId('db-status')).toHaveText('Locked');
  });

  test('should persist data across lock/unlock cycles', async ({ page }) => {
    // Setup database and write data
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write data
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const writtenValue = await page.getByTestId('db-test-data').textContent();

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock the database
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read data and verify it persisted
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);
    const readValue = await page.getByTestId('db-test-data').textContent();

    expect(readValue).toBe(writtenValue);
  });

  test('should reset database and clear all data', async ({ page }) => {
    // Setup database and write data
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await page.getByTestId('db-write-button').click();
    await expect(page.getByTestId('db-test-data')).toBeVisible();

    // Reset the database
    await page.getByTestId('db-reset-button').click();
    await waitForSuccess(page);

    // Verify database is in "Not Set Up" state
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');

    // Test data should be cleared
    await expect(page.getByTestId('db-test-data')).not.toBeVisible();

    // Setup button should be visible again
    await expect(page.getByTestId('db-setup-button')).toBeVisible();
  });

  test('should setup database again after reset', async ({ page }) => {
    // Setup database first
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some data
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    // Reset the database
    await page.getByTestId('db-reset-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');

    // Setup database again with a new password
    await page.getByTestId('db-password-input').fill(NEW_PASSWORD);
    await page.getByTestId('db-setup-button').click();

    // Wait for setup to complete - this is where the bug occurs
    await waitForSuccess(page);

    // Verify database is unlocked again
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Database setup complete'
    );

    // Write and read data to verify the new database works
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    const newValue = await page.getByTestId('db-test-data').textContent();
    expect(newValue).toMatch(/^test-value-\d+$/);
  });

  test('should change password successfully', async ({ page }) => {
    // Setup database first
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some data to verify it persists after password change
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const writtenValue = await page.getByTestId('db-test-data').textContent();

    // Open change password UI
    await page.getByTestId('db-change-password-toggle').click();

    // Enter new password
    await page.getByTestId('db-new-password-input').fill(NEW_PASSWORD);

    // Click confirm change
    await page.getByTestId('db-change-password-button').click();

    // Wait for change to complete
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Password changed successfully'
    );

    // Verify database is still unlocked
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');

    // Lock the database
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock with old password (should fail)
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await waitForError(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrong password'
    );

    // Unlock with new password (should succeed)
    await page.getByTestId('db-password-input').fill(NEW_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify data persisted across password change
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);
    const readValue = await page.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });

  test('should fail to change password with wrong current password', async ({
    page
  }) => {
    // Setup database first
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Open change password UI
    await page.getByTestId('db-change-password-toggle').click();

    // Enter wrong current password
    await page.getByTestId('db-password-input').fill('wrongpassword');

    // Enter new password
    await page.getByTestId('db-new-password-input').fill(NEW_PASSWORD);

    // Click confirm change
    await page.getByTestId('db-change-password-button').click();

    // Wait for error
    await waitForError(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrong current password'
    );

    // Verify database is still unlocked (change failed but didn't break anything)
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
  });
});

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
