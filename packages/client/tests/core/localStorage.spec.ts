import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const TEST_STORAGE_KEY = 'qa-local-storage-key';
const TEST_STORAGE_VALUE = 'qa-local-storage-value';

test.use({ viewport: DESKTOP_VIEWPORT });

test.describe('Local storage window', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.addInitScript(({ storageKey, storageValue }) => {
      localStorage.setItem(storageKey, storageValue);
    }, { storageKey: TEST_STORAGE_KEY, storageValue: TEST_STORAGE_VALUE });
  });

  test('clearing local storage keeps the app responsive', async ({ page }) => {
    // Navigate directly to local-storage page (now under /debug/browser/)
    await page.goto('/debug/browser/local-storage');

    // Wait for the page content to load
    const clearButton = page.getByRole('button', {
      name: 'Clear all localStorage'
    });
    await expect(clearButton).toBeVisible({ timeout: 15000 });

    // Verify test key is visible
    await expect(page.getByText(TEST_STORAGE_KEY)).toBeVisible();

    // Click clear button
    await clearButton.click();

    // Handle confirmation dialog
    const confirmDialog = page.getByTestId('confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByTestId('confirm-dialog-confirm').click();
    await expect(confirmDialog).not.toBeVisible();

    // Verify key is cleared
    await expect(page.getByText(TEST_STORAGE_KEY)).toHaveCount(0);

    // Verify app is still responsive by navigating to another page
    await page.goto('/settings');
    await expect(page.getByText('Theme')).toBeVisible({ timeout: 15000 });
  });
});
