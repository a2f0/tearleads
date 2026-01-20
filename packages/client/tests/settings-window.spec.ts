import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

test.describe('Settings Window (Web)', () => {
  test('opens settings window from header button on desktop', async ({
    page
  }) => {
    await clearOriginStorage(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    await page.getByTestId('settings-button').click();

    await expect(
      page.locator('[data-testid^="floating-window-settings-"][role="dialog"]')
    ).toBeVisible();
  });
});
