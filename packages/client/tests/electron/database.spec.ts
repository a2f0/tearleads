import {
  test,
  expect,
  ElectronApplication,
  Page
} from '@playwright/test';
import {launchElectronApp} from './electron-test-helper';

const TEST_PASSWORD = 'testpassword123';
const NEW_PASSWORD = 'newpassword456';
const DB_OPERATION_TIMEOUT = 15000;
const APP_LOAD_TIMEOUT = 10000;

async function openSidebar(window: Page) {
  const startButton = window.getByTestId('start-button');
  await expect(startButton).toBeVisible({timeout: APP_LOAD_TIMEOUT});
  await startButton.click();
  await expect(window.locator('nav')).toBeVisible({timeout: APP_LOAD_TIMEOUT});
}

test.describe('Database (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();

    // Wait for app to load - verify Start button is visible
    await expect(
      window.getByTestId('start-button')
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Open sidebar and navigate to SQLite page
    await openSidebar(window);
    await window.locator('nav').getByRole('link', { name: 'SQLite' }).click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Reset the database to ensure clean state
    const resetButton = window.getByTestId('db-reset-button');
    await resetButton.click();

    // Wait for reset to complete
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should setup a new database with password', async () => {
    // Verify initial state
    await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');

    // Enter password
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);

    // Click setup button
    const setupButton = window.getByTestId('db-setup-button');
    await expect(setupButton).toBeVisible();
    await setupButton.click();

    // Wait for setup to complete
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Verify database is now unlocked
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked');
    await expect(window.getByTestId('db-test-result')).toContainText(
      'Database setup complete'
    );
  });

  test('should write and read data from database', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write data
    const writeButton = window.getByTestId('db-write-button');
    await expect(writeButton).toBeVisible();
    await writeButton.click();

    // Wait for write to complete
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Verify test data is displayed
    await expect(window.getByTestId('db-test-data')).toBeVisible();
    const writtenValue = await window.getByTestId('db-test-data').textContent();
    expect(writtenValue).toMatch(/^test-value-\d+$/);

    // Read data
    await window.getByTestId('db-read-button').click();

    // Wait for read to complete
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Verify the read value matches the written value
    const readValue = await window.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });

  test('should lock and unlock database', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Lock the database
    await window.getByTestId('db-lock-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(window.getByTestId('db-status')).toHaveText('Locked');

    // Unlock the database
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked');
  });

  test('should fail to unlock with wrong password', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Lock the database
    await window.getByTestId('db-lock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock with wrong password
    await window.getByTestId('db-password-input').fill('wrongpassword');
    await window.getByTestId('db-unlock-button').click();

    // Verify error
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'error',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(window.getByTestId('db-test-result')).toContainText(
      'Wrong password'
    );
    await expect(window.getByTestId('db-status')).toHaveText('Locked');
  });

  test('should persist data across lock/unlock cycles', async () => {
    // Setup and write data
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await window.getByTestId('db-write-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const writtenValue = await window.getByTestId('db-test-data').textContent();

    // Lock and unlock
    await window.getByTestId('db-lock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read and verify data persisted
    await window.getByTestId('db-read-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const readValue = await window.getByTestId('db-test-data').textContent();

    expect(readValue).toBe(writtenValue);
  });

  test('should persist data across app restarts', async () => {
    // Setup and write data
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await window.getByTestId('db-write-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const writtenValue = await window.getByTestId('db-test-data').textContent();

    // Close the app
    await electronApp.close();

    // Relaunch the app without clearing storage to test persistence
    electronApp = await launchElectronApp({clearStorage: false});
    window = await electronApp.firstWindow();

    // Wait for app to load and navigate to SQLite page
    await expect(
      window.getByTestId('start-button')
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await openSidebar(window);
    await window.locator('nav').getByRole('link', { name: 'SQLite' }).click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Database should be in "Locked" state (set up but not unlocked)
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Unlock with password
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Read and verify data persisted
    await window.getByTestId('db-read-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const readValue = await window.getByTestId('db-test-data').textContent();

    expect(readValue).toBe(writtenValue);
  });

  test('should change password successfully', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some data to verify it persists after password change
    await window.getByTestId('db-write-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const writtenValue = await window.getByTestId('db-test-data').textContent();

    // Open change password UI
    await window.getByTestId('db-change-password-toggle').click();

    // Enter new password
    await window.getByTestId('db-new-password-input').fill(NEW_PASSWORD);

    // Click confirm change
    await window.getByTestId('db-change-password-button').click();

    // Wait for change to complete
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(window.getByTestId('db-test-result')).toContainText(
      'Password changed successfully'
    );

    // Verify database is still unlocked
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked');

    // Lock the database
    await window.getByTestId('db-lock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Try to unlock with old password (should fail)
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'error',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(window.getByTestId('db-test-result')).toContainText(
      'Wrong password'
    );

    // Unlock with new password (should succeed)
    await window.getByTestId('db-password-input').fill(NEW_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify data persisted across password change
    await window.getByTestId('db-read-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const readValue = await window.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });

  test('should persist data across app restarts after password change', async () => {
    // Setup and write data
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    await window.getByTestId('db-write-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const writtenValue = await window.getByTestId('db-test-data').textContent();

    // Change password
    await window.getByTestId('db-change-password-toggle').click();
    await window.getByTestId('db-new-password-input').fill(NEW_PASSWORD);
    await window.getByTestId('db-change-password-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // Close the app
    await electronApp.close();

    // Relaunch the app without clearing storage to test persistence
    electronApp = await launchElectronApp({clearStorage: false});
    window = await electronApp.firstWindow();

    // Wait for app to load and navigate to SQLite page
    await expect(
      window.getByTestId('start-button')
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await openSidebar(window);
    await window.locator('nav').getByRole('link', { name: 'SQLite' }).click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Database should be in "Locked" state
    await expect(window.getByTestId('db-status')).toHaveText('Locked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Old password should fail
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'error',
      { timeout: DB_OPERATION_TIMEOUT }
    );

    // New password should work
    await window.getByTestId('db-password-input').fill(NEW_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify data persisted
    await window.getByTestId('db-read-button').click();
    await expect(window.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    const readValue = await window.getByTestId('db-test-data').textContent();
    expect(readValue).toBe(writtenValue);
  });
});
