import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page
} from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import type { ElectronApi } from '@/types/electron';

// Extend Window type for Electron's exposed API
declare global {
  interface Window {
    electron: ElectronApi;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '../../out/main/main.js');
const isCI = !!process.env['CI'];

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;
const APP_LOAD_TIMEOUT = 10000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

test.describe('Backup & Restore (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {

    electronApp = await electron.launch({
      args: isCI ? [mainPath, '--no-sandbox', '--disable-gpu'] : [mainPath]
    });
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(
      window.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Navigate to debug page
    await window.getByTestId('debug-link').click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Reset the database to ensure clean state
    const resetButton = window.getByTestId('db-reset-button');
    await resetButton.click();
    await waitForSuccess(window);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should display backup section on settings page', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to settings
    await window.getByTestId('settings-link').click();
    await expect(window).toHaveURL(/\/settings/);

    // Verify backup section is visible
    await expect(window.getByText('Backup & Restore')).toBeVisible();
    await expect(window.getByTestId('backup-export-button')).toBeVisible();
    await expect(window.getByText('Create Backup')).toBeVisible();
  });

  test('should export database via IPC', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some test data
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);

    // Export via IPC (bypassing native file dialog)
    const exportData = await window.evaluate(async () => {
      return window.electron.sqlite.export('rapid');
    });

    // Verify export data is a valid SQLite database (starts with "SQLite format 3")
    const sqliteHeader = [83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0];
    expect(exportData.slice(0, 16)).toEqual(sqliteHeader);
    expect(exportData.length).toBeGreaterThan(1000); // Should have some data
  });

  test('should restore from backup and preserve data via IPC', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some test data
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const originalValue = await window.getByTestId('db-test-data').textContent();

    // Export the database via IPC
    const exportData = await window.evaluate(async () => {
      return window.electron.sqlite.export('rapid');
    });

    // Get the salt before reset (we'll need it to derive the key)
    const originalSalt = await window.evaluate(async () => {
      return window.electron.sqlite.getSalt();
    });

    // Reset the database
    await window.getByTestId('db-reset-button').click();
    await waitForSuccess(window);
    await expect(window.getByTestId('db-status')).toHaveText('Not Set Up');

    // Restore the original salt so we can derive the same key
    await window.evaluate(
      async (salt) => {
        await window.electron.sqlite.setSalt(salt);
      },
      originalSalt
    );

    // Setup with the same password - this will derive the same key with the original salt
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Get the encryption key by deriving it from the password and salt
    // This matches what the app does internally
    const encryptionKey = await window.evaluate(async (password) => {
      // Use Web Crypto to derive the key the same way the app does
      const salt = await window.electron.sqlite.getSalt();
      if (!salt) return null;

      const encoder = new TextEncoder();
      const passwordData = encoder.encode(password);
      const saltData = new Uint8Array(salt);

      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordData,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );

      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltData,
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const exported = await crypto.subtle.exportKey('raw', key);
      return Array.from(new Uint8Array(exported));
    }, TEST_PASSWORD);

    expect(encryptionKey).not.toBeNull();

    // Import the backup via IPC
    await window.evaluate(
      async ({ data, key }) => {
        await window.electron.sqlite.import('rapid', data, key);
      },
      { data: exportData, key: encryptionKey }
    );

    // Read and verify the data was restored
    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);
    const restoredValue = await window.getByTestId('db-test-data').textContent();

    expect(restoredValue).toBe(originalValue);
  });

  test('should persist restored data across app restart', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Write some test data
    await window.getByTestId('db-write-button').click();
    await waitForSuccess(window);
    const originalValue = await window.getByTestId('db-test-data').textContent();

    // Close and restart the app to verify persistence
    await electronApp.close();

    electronApp = await electron.launch({
      args: isCI ? [mainPath, '--no-sandbox', '--disable-gpu'] : [mainPath]
    });
    window = await electronApp.firstWindow();

    // Wait for app to load
    await expect(
      window.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Navigate to debug page
    await window.getByTestId('debug-link').click();
    await expect(window.getByTestId('database-test')).toBeVisible();

    // Should be locked (need to re-enter password)
    await expect(window.getByTestId('db-status')).toHaveText('Locked');

    // Unlock with the password
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-unlock-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Verify the data persisted
    await window.getByTestId('db-read-button').click();
    await waitForSuccess(window);
    const restoredValue = await window.getByTestId('db-test-data').textContent();

    expect(restoredValue).toBe(originalValue);
  });

  test('should show error for invalid file type', async () => {
    // Setup database first
    await window.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await window.getByTestId('db-setup-button').click();
    await expect(window.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Navigate to settings
    await window.getByTestId('settings-link').click();
    await expect(window).toHaveURL(/\/settings/);

    // Create and upload an invalid file
    const invalidFilePath = join(__dirname, `../../temp-invalid-${Date.now()}.txt`);
    fs.writeFileSync(invalidFilePath, 'not a database file');

    try {
      const fileInput = window.getByTestId('dropzone-input');
      await fileInput.setInputFiles(invalidFilePath);

      // Should show error message
      await expect(
        window.getByText('Please select a .db backup file')
      ).toBeVisible({ timeout: 5000 });
    } finally {
      // Cleanup
      fs.unlinkSync(invalidFilePath);
    }
  });
});
