import { test, expect } from '@playwright/test';

test.describe('Index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load and display the main heading', async ({ page }) => {
    await expect(page).toHaveTitle('Tearleads');

    const heading = page.getByRole('heading', { name: 'Tearleads', level: 1 });
    await expect(heading).toBeVisible();
  });

  test('should have the root element mounted', async ({ page }) => {
    const rootElement = page.locator('#root');
    await expect(rootElement).not.toBeEmpty();

    const appContainer = page.getByTestId('app-container');
    await expect(appContainer).toBeVisible();
  });

  test('should toggle dark mode', async ({ page }) => {
    const toggleButton = page.getByRole('button', { name: 'Toggle dark mode' });
    await expect(toggleButton).toBeVisible();

    // Get initial state
    const htmlElement = page.locator('html');
    const initialDark = await htmlElement.evaluate((el) =>
      el.classList.contains('dark')
    );

    // Toggle
    await toggleButton.click();

    // Verify class changed
    const afterToggle = await htmlElement.evaluate((el) =>
      el.classList.contains('dark')
    );
    expect(afterToggle).toBe(!initialDark);
  });

  test('should change background color when dark mode is toggled', async ({
    page
  }) => {
    const toggleButton = page.getByRole('button', { name: 'Toggle dark mode' });
    const appContainer = page.getByTestId('app-container');

    // Get initial background color
    const initialBgColor = await appContainer.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );

    // Toggle dark mode
    await toggleButton.click();

    // Get new background color
    const newBgColor = await appContainer.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );

    // Background colors should be different
    expect(newBgColor).not.toBe(initialBgColor);

    // Toggle back
    await toggleButton.click();

    // Should return to original color
    const restoredBgColor = await appContainer.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );
    expect(restoredBgColor).toBe(initialBgColor);
  });
});

test.describe('Debug menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should open debug menu when bug button is clicked', async ({ page }) => {
    const debugButton = page.getByRole('button', { name: 'Open debug menu' });
    await expect(debugButton).toBeVisible();

    await debugButton.click();

    const debugMenu = page.getByText('Debug Menu');
    await expect(debugMenu).toBeVisible();
  });

  test('should display environment info in debug menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Open debug menu' }).click();

    await expect(page.getByText(/Environment/)).toBeVisible();
    await expect(page.getByText(/Screen/)).toBeVisible();
    await expect(page.getByText(/User Agent/)).toBeVisible();
  });

  test('should fetch and display API health status', async ({ page }) => {
    await page.getByRole('button', { name: 'Open debug menu' }).click();

    // Wait for health data to load (either success or error)
    const healthStatus = page.getByText(/Healthy|Failed to connect to API/);
    await expect(healthStatus).toBeVisible({ timeout: 10000 });
  });

  test('should refresh health data when refresh button is clicked', async ({
    page
  }) => {
    await page.getByRole('button', { name: 'Open debug menu' }).click();

    // Wait for initial load to complete (button becomes enabled)
    const refreshButton = page.getByRole('button', { name: /^Refresh$/ });
    await expect(refreshButton).toBeEnabled({ timeout: 10000 });

    // Force click due to overlapping elements in the scrollable container
    await refreshButton.click({ force: true });

    // Should show refreshing state or remain showing data
    await expect(
      page.getByRole('button', { name: /Refresh|Refreshing/ })
    ).toBeVisible();
  });

  test('should close debug menu when X button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Open debug menu' }).click();
    await expect(page.getByText('Debug Menu')).toBeVisible();

    // Click the X button (not the backdrop)
    const closeButtons = page.getByRole('button', { name: 'Close debug menu' });
    await closeButtons.first().click();

    await expect(page.getByText('Debug Menu')).not.toBeVisible();
  });

  test('should close debug menu when backdrop is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Open debug menu' }).click();
    await expect(page.getByText('Debug Menu')).toBeVisible();

    // Click the backdrop (the button covering the screen)
    const backdrop = page.locator('button.bg-black\\/50');
    await backdrop.click();

    await expect(page.getByText('Debug Menu')).not.toBeVisible();
  });
});
