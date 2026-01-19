import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const TEST_STORAGE_KEY = 'qa-local-storage-key';
const TEST_STORAGE_VALUE = 'qa-local-storage-value';

test.use({ viewport: DESKTOP_VIEWPORT });

async function openSidebar(page: Page): Promise<void> {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeVisible({ timeout: 10000 });

  if ((await startButton.getAttribute('aria-pressed')) !== 'true') {
    await startButton.click();
  }

  await expect(page.locator('aside nav')).toBeVisible({ timeout: 10000 });
}

async function openWindowFromSidebar(
  page: Page,
  testId: string
): Promise<void> {
  await openSidebar(page);
  await page.getByTestId(testId).click();
}

test.describe('Local storage window', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.addInitScript(({ storageKey, storageValue }) => {
      localStorage.setItem(
        'window-dimensions:local-storage',
        JSON.stringify({ width: 500, height: 400, x: 10, y: 10 })
      );
      localStorage.setItem(storageKey, storageValue);
    }, { storageKey: TEST_STORAGE_KEY, storageValue: TEST_STORAGE_VALUE });
  });

  test('clearing local storage keeps the app responsive', async ({ page }) => {
    await page.goto('/');

    await openWindowFromSidebar(page, 'local-storage-link');
    const localStorageWindow = page.getByRole('dialog', {
      name: 'Local Storage'
    });
    await expect(localStorageWindow).toBeVisible({ timeout: 10000 });
    await expect(localStorageWindow.getByText(TEST_STORAGE_KEY)).toBeVisible();

    await localStorageWindow
      .getByRole('button', { name: 'Clear all localStorage' })
      .click();

    const confirmDialog = page.getByTestId('confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByTestId('confirm-dialog-confirm').click();
    await expect(confirmDialog).not.toBeVisible();

    await expect(
      localStorageWindow.getByText(TEST_STORAGE_KEY)
    ).toHaveCount(0);

    await openWindowFromSidebar(page, 'settings-link');
    await expect(
      page.getByRole('dialog', { name: 'Settings' })
    ).toBeVisible({ timeout: 10000 });
  });
});
