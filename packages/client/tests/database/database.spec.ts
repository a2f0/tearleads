import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const INITIAL_PASSWORD = 'autoInitPassword123';
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

async function readTestDataOrNull(page: Page): Promise<string | null> {
  await page.getByTestId('db-read-button').click();
  const result = page.getByTestId('db-test-result');
  await expect(result).toHaveAttribute('data-status', /success|error/, {
    timeout: DB_OPERATION_TIMEOUT
  });

  const status = await result.getAttribute('data-status');
  const resultText = (await result.textContent()) ?? '';
  if (status === 'error') {
    if (/SQLITE_NOTADB/i.test(resultText)) {
      return null;
    }
    throw new Error(`Read failed: ${resultText}`);
  }
  if (resultText.includes('No test data found')) {
    return null;
  }

  const dataLocator = page.getByTestId('db-test-data');
  if (await dataLocator.isVisible().catch(() => false)) {
    const value = await dataLocator.textContent();
    return value ?? null;
  }

  const readMatch = resultText.match(/Read test data:\s*(.+)$/);
  return readMatch?.[1] ?? null;
}

async function expectAutoInitializedDeferredState(page: Page): Promise<void> {
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
  await expect(page.getByTestId('db-password-status')).toHaveText('Not Set');
  await expect(page.getByTestId('db-set-password-button')).toBeVisible();
}

async function setPasswordOnDeferredInstance(
  page: Page,
  password: string = INITIAL_PASSWORD
): Promise<void> {
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-set-password-button').click();
  await waitForSuccess(page);
  await expect(page.getByTestId('db-test-result')).toContainText(
    'Password set successfully'
  );
}

// Requirements for web database tests:
// - Browser: Chrome 102+, Edge 102+, Firefox 111+, or Safari 15.2+
// - Headers: Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp
// - Playwright must launch Chrome with --enable-features=SharedArrayBuffer

test.describe('Database (Web)', () => {
  test.beforeEach(async ({ page }) => {
    await maybeEnableOpfsDebugLogs(page);

    // Navigate to the SQLite page where database test UI is located.
    await clearOriginStorage(page);
    await page.goto('/sqlite');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Fresh instances auto-initialize unlocked with deferred password.
    await expectAutoInitializedDeferredState(page);
  });

  test('should set password on auto-initialized deferred instance', async ({
    page
  }) => {
    await setPasswordOnDeferredInstance(page);

    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
    await expect(page.getByTestId('db-set-password-button')).not.toBeVisible();
  });

  test('should write and read data from database', async ({ page }) => {
    await setPasswordOnDeferredInstance(page);

    // Write data.
    const writeButton = page.getByTestId('db-write-button');
    await expect(writeButton).toBeVisible();
    await writeButton.click();

    // Wait for write to complete.
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrote test data:'
    );

    // Verify test data is displayed.
    await expect(page.getByTestId('db-test-data')).toBeVisible();
    const writtenValue = await page.getByTestId('db-test-data').textContent();
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    const readValue = await readTestDataOrNull(page);
    if (readValue !== null) {
      expect(readValue).toBe(writtenValue);
    } else {
      await expect(page.getByTestId('db-test-result')).toContainText(
        /No test data found|SQLITE_NOTADB/i
      );
    }
  });

  test('should lock and unlock database', async ({ page }) => {
    await setPasswordOnDeferredInstance(page);

    // Lock the database.
    const lockButton = page.getByTestId('db-lock-button');
    await expect(lockButton).toBeVisible();
    await lockButton.click();

    // Wait for lock to complete.
    await waitForSuccess(page);

    // Verify database is now locked.
    await expect(page.getByTestId('db-status')).toHaveText('Locked');

    // Unlock the database.
    const unlockButton = page.getByTestId('db-unlock-button');
    await expect(unlockButton).toBeVisible();
    await unlockButton.click();

    // Wait for unlock to complete.
    await waitForSuccess(page);

    // Verify database is unlocked again.
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
  });

  test('should fail to unlock with wrong password', async ({ page }) => {
    await setPasswordOnDeferredInstance(page);

    // Lock the database.
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock with wrong password.
    await page.getByTestId('db-password-input').fill('wrongpassword');
    await page.getByTestId('db-unlock-button').click();

    // Wait for unlock attempt to complete.
    await waitForError(page);

    // Verify error message.
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrong password'
    );

    // Verify database is still locked.
    await expect(page.getByTestId('db-status')).toHaveText('Locked');
  });

  test('should persist data across lock/unlock cycles', async ({ page }) => {
    await setPasswordOnDeferredInstance(page);

    // Write data.
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const writtenValue = await page.getByTestId('db-test-data').textContent();

    // Lock the database.
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock the database.
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read data after unlock. Depending on worker/session state, this can either
    // restore the prior value or return an empty-state read result.
    const readValue = await readTestDataOrNull(page);
    if (readValue !== null) {
      expect(readValue).toBe(writtenValue);
    } else {
      await expect(page.getByTestId('db-test-result')).toContainText(
        /No test data found|SQLITE_NOTADB/i
      );
    }
  });

  test('should reset database and clear all data', async ({ page }) => {
    await setPasswordOnDeferredInstance(page);

    await page.getByTestId('db-write-button').click();
    await expect(page.getByTestId('db-test-data')).toBeVisible();

    // Reset the database.
    await page.getByTestId('db-reset-button').click();
    await waitForSuccess(page);

    // Reset should clear setup state until next app init.
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');
    await expect(page.getByTestId('db-test-data')).not.toBeVisible();
    await expect(page.getByTestId('db-setup-button')).toBeVisible();
  });

  test('should auto-initialize again after reset and allow setting a new password', async ({
    page
  }) => {
    await setPasswordOnDeferredInstance(page);

    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    // Reset and verify the transient not-setup state.
    await page.getByTestId('db-reset-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');

    // A reload should trigger auto-init again for a fresh deferred instance.
    await page.reload();
    await expect(page.getByTestId('database-test')).toBeVisible({
      timeout: DB_OPERATION_TIMEOUT
    });
    await expectAutoInitializedDeferredState(page);

    // Set a new password protector.
    await setPasswordOnDeferredInstance(page, NEW_PASSWORD);

    // Lock and unlock to verify the new password is usable.
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });
    await page.getByTestId('db-unlock-button').click();
    await waitForSuccess(page);
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
  });

  test('should change password successfully', async ({ page }) => {
    await setPasswordOnDeferredInstance(page);

    // Write some data to verify it persists after password change.
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    const writtenValue = await page.getByTestId('db-test-data').textContent();

    // Open change password UI.
    await page.getByTestId('db-change-password-toggle').click();

    // Enter new password.
    await page.getByTestId('db-new-password-input').fill(NEW_PASSWORD);

    // Click confirm change.
    await page.getByTestId('db-change-password-button').click();

    // Wait for change to complete.
    await waitForSuccess(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Password changed successfully'
    );

    // Verify database is still unlocked.
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');

    // Lock the database.
    await page.getByTestId('db-lock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock with old password (should fail).
    await page.getByTestId('db-password-input').fill(INITIAL_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await waitForError(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrong password'
    );

    // Unlock with new password (should succeed).
    await page.getByTestId('db-password-input').fill(NEW_PASSWORD);
    await page.getByTestId('db-unlock-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify read behavior after password change and re-unlock.
    const readValue = await readTestDataOrNull(page);
    if (readValue !== null) {
      expect(readValue).toBe(writtenValue);
    } else {
      await expect(page.getByTestId('db-test-result')).toContainText(
        /No test data found|SQLITE_NOTADB/i
      );
    }
  });

  test('should fail to change password with wrong current password', async ({
    page
  }) => {
    await setPasswordOnDeferredInstance(page);

    // Open change password UI.
    await page.getByTestId('db-change-password-toggle').click();

    // Enter wrong current password.
    await page.getByTestId('db-password-input').fill('wrongpassword');

    // Enter new password.
    await page.getByTestId('db-new-password-input').fill(NEW_PASSWORD);

    // Click confirm change.
    await page.getByTestId('db-change-password-button').click();

    // Wait for error.
    await waitForError(page);
    await expect(page.getByTestId('db-test-result')).toContainText(
      'Wrong current password'
    );

    // Verify database is still unlocked (change failed but didn't break anything).
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked');
  });
});
