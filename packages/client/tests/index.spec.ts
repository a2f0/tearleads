import { test, expect } from '@playwright/test';

test.describe('Index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load and display the main heading', async ({ page }) => {
    // Check that the page title is correct
    await expect(page).toHaveTitle('Rapid');

    // Check that the main heading is present
    const heading = page.getByRole('heading', { name: 'Rapid Monorepo', level: 1 });
    await expect(heading).toBeVisible();
  });

  test('should display the API health check section', async ({ page }) => {
    // Check that the health check section heading is present
    const healthHeading = page.getByRole('heading', { name: 'API Health Check', level: 3 });
    await expect(healthHeading).toBeVisible();

    // Check that the refresh button is present
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible();
  });

  test('should show loading state initially', async ({ page }) => {
    // The page should show a loading state when fetching health data
    // This might be brief, but we can check for either loading text or the loaded content
    const loadingOrError = page.getByText(/Loading\.\.\.|Failed to connect to API|Healthy/);
    await expect(loadingOrError).toBeVisible();
  });

  test('should have the root element mounted', async ({ page }) => {
    // Verify that the React app is mounted to the #root element
    const rootElement = page.locator('#root');
    await expect(rootElement).not.toBeEmpty();

    // Verify the app container is present
    const appContainer = page.getByTestId('app-container');
    await expect(appContainer).toBeVisible();
  });

  test('should have Tailwind CSS and shadcn styles loaded', async ({ page }) => {
    // Wait for the card to be visible
    const card = page.locator('.rounded-lg.border.bg-card').first();
    await expect(card).toBeVisible();

    // Verify that Tailwind/shadcn styles are applied by checking computed styles
    const cardStyles = await card.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        borderRadius: styles.borderRadius,
        borderWidth: styles.borderWidth,
        boxShadow: styles.boxShadow,
        backgroundColor: styles.backgroundColor
      };
    });

    // Verify styles are not default values (indicating CSS is loaded)
    expect(cardStyles.borderRadius).not.toBe('0px');
    expect(cardStyles.borderWidth).not.toBe('0px');
    expect(cardStyles.boxShadow).not.toBe('none');

    // Check that the Button component has proper styling
    const button = page.getByRole('button', { name: /Refresh/ });
    const buttonStyles = await button.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        display: styles.display,
        alignItems: styles.alignItems,
        justifyContent: styles.justifyContent,
        borderRadius: styles.borderRadius,
        backgroundColor: styles.backgroundColor
      };
    });

    // Verify button has flex display (from inline-flex class)
    expect(buttonStyles.display).toBe('inline-flex');
    expect(buttonStyles.alignItems).toBe('center');
    expect(buttonStyles.justifyContent).toBe('center');
    expect(buttonStyles.borderRadius).not.toBe('0px');
  });
});
