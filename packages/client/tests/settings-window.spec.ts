import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

test.describe('Settings Window (Web)', () => {
  test('settings page is accessible and renders correctly', async ({ page }) => {
    await clearOriginStorage(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Navigate directly to settings to avoid flaky touch/mobile detection
    await page.goto('/settings');

    // Verify settings content renders
    await expect(page.getByText('Theme')).toBeVisible({ timeout: 15000 });
  });
});
