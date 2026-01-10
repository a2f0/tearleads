import { expect, test } from '@playwright/test';

test.describe('Website Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('home page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle('Rapid');
    await expect(page.locator('h2')).toContainText('Welcome to Rapid');
  });

  test('navigates to architecture page when clicking architecture link', async ({
    page,
  }) => {
    // Find and click the architecture link
    const architectureLink = page.locator('a[href="/architecture"]');
    await expect(architectureLink).toBeVisible();
    await architectureLink.click();

    // Verify navigation occurred
    await expect(page).toHaveURL(/\/architecture\/?$/);
    await expect(page).toHaveTitle('Architecture - Rapid');

    // Verify the page content changed (h1 in main content area)
    await expect(
      page.locator('.encryption-diagram h1, main h1#database-encryption-architecture')
    ).toBeVisible();
  });

  test('navigates to docs page when clicking docs link', async ({ page }) => {
    // Find and click the docs link
    const docsLink = page.locator('a[href="/docs"]');
    await expect(docsLink).toBeVisible();
    await docsLink.click();

    // Verify navigation occurred
    await expect(page).toHaveURL(/\/docs\/?$/);
    await expect(page).toHaveTitle('API Documentation - Rapid');

    // Verify SwaggerUI is present
    await expect(page.locator('.swagger-ui-container')).toBeVisible();
  });

  test('back link on architecture page returns to home', async ({ page }) => {
    // Navigate to architecture page
    await page.goto('/architecture');
    await expect(page).toHaveTitle('Architecture - Rapid');

    // Click back link
    const backLink = page.locator('a[href="/"]');
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Verify we're back on home page
    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle('Rapid');
  });

  test('back link on docs page returns to home', async ({ page }) => {
    // Navigate to docs page
    await page.goto('/docs');
    await expect(page).toHaveTitle('API Documentation - Rapid');

    // Click back link
    const backLink = page.locator('a[href="/"]');
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Verify we're back on home page
    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle('Rapid');
  });

  test('can navigate between all pages in sequence', async ({ page }) => {
    // Home -> Architecture
    await page.locator('a[href="/architecture"]').click();
    await expect(page).toHaveTitle('Architecture - Rapid');

    // Architecture -> Home (via back link)
    await page.locator('a[href="/"]').click();
    await expect(page).toHaveTitle('Rapid');

    // Home -> Docs
    await page.locator('a[href="/docs"]').click();
    await expect(page).toHaveTitle('API Documentation - Rapid');

    // Docs -> Home (via back link)
    await page.locator('a[href="/"]').click();
    await expect(page).toHaveTitle('Rapid');
  });

  test('direct URL navigation works for architecture page', async ({
    page,
  }) => {
    await page.goto('/architecture');
    await expect(page).toHaveTitle('Architecture - Rapid');
    await expect(
      page.locator('.encryption-diagram h1, main h1#database-encryption-architecture')
    ).toBeVisible();
  });

  test('direct URL navigation works for docs page', async ({ page }) => {
    await page.goto('/docs');
    await expect(page).toHaveTitle('API Documentation - Rapid');
    await expect(page.locator('.swagger-ui-container')).toBeVisible();
  });

  test('navigation preserves theme setting', async ({ page }) => {
    // Wait for theme switcher to be interactive
    const themeSwitcher = page.locator('[data-testid="theme-switcher"]');
    await expect(themeSwitcher).toBeVisible();

    // Get initial theme
    const htmlBefore = page.locator('html');
    const initialTheme = await htmlBefore.getAttribute('class');

    // Navigate to another page
    await page.locator('a[href="/architecture"]').click();
    await expect(page).toHaveTitle('Architecture - Rapid');

    // Verify theme is preserved
    const htmlAfter = page.locator('html');
    const themeAfter = await htmlAfter.getAttribute('class');
    expect(themeAfter).toBe(initialTheme);
  });
});
