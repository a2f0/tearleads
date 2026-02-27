import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

test.describe('Settings Window (Web)', () => {
  test('settings page is accessible and renders correctly', async ({ page }) => {
    await clearOriginStorage(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Navigate directly to settings to avoid flaky touch/mobile detection
    await page.goto('/settings');

    // Verify settings content renders
    await expect(page.getByText('Theme')).toBeVisible({ timeout: 15000 });
  });

  test('settings button opens settings window on desktop', async ({ page }) => {
    await clearOriginStorage(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Navigate to home page
    await page.goto('/');

    // Wait for the page to load
    await expect(page.getByTestId('settings-button')).toBeVisible({
      timeout: 15000
    });

    // Click the settings button
    await page.getByTestId('settings-button').click();

    // Verify the settings window opens (FloatingWindow with Settings content)
    await expect(page.getByText('Theme')).toBeVisible({ timeout: 5000 });
  });

  test('View > Options no longer exposes fit-to-content', async ({ page }) => {
    await clearOriginStorage(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');

    await expect(page.getByTestId('settings-button')).toBeVisible({
      timeout: 15000
    });
    await page.getByTestId('settings-button').click();

    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog
      .locator('button[aria-haspopup="menu"]', { hasText: 'View' })
      .click();
    await page.getByRole('menuitem', { name: 'Options' }).click();
    await expect(page.getByTestId('window-options-fit-content')).toHaveCount(0);
  });
});
