import { test, expect } from '@playwright/test';

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;

// Skip database tests in CI - WASM with web workers in headless Chrome is unreliable.
// Database functionality is tested via Electron E2E tests (native SQLite) and
// mobile Maestro tests.
const isCI = !!process.env['CI'];

test.describe('Database (Web)', () => {
  test.skip(isCI, 'Skipping WASM database tests in CI - tested via Electron E2E instead');
  test.beforeEach(async ({ page }) => {
    // Navigate to the debug page where database test UI is located
    await page.goto('/debug');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Reset the database to ensure clean state
    const resetButton = page.getByTestId('db-reset-button');
    await resetButton.click();

    // Wait for reset to complete
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Verify database is now locked
    await expect(page.getByTestId('db-status')).toHaveText('Locked');

    // Unlock the database
    const unlockButton = page.getByTestId('db-unlock-button');
    await expect(unlockButton).toBeVisible();
    await unlockButton.click();

    // Wait for unlock to complete
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'error',
      { timeout: DB_OPERATION_TIMEOUT }
    );

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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
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
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Verify database is in "Not Set Up" state
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');

    // Test data should be cleared
    await expect(page.getByTestId('db-test-data')).not.toBeVisible();

    // Setup button should be visible again
    await expect(page.getByTestId('db-setup-button')).toBeVisible();
  });
});
