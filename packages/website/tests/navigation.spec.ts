import { expect, test } from '@playwright/test';

const locators = {
  architectureLink: 'a[href="/architecture"]',
  docsLink: 'a[href="/docs"]',
  homeLink: 'a[href="/"]',
  architectureContent: '[data-testid="architecture-content"]',
  swaggerContainer: '.swagger-ui-container',
  themeSwitcher: '[data-testid="theme-switcher"]',
};

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
    const architectureLink = page.locator(locators.architectureLink);
    await expect(architectureLink).toBeVisible();
    await architectureLink.click();

    await expect(page).toHaveURL(/\/architecture\/?$/);
    await expect(page).toHaveTitle('Architecture - Rapid');
    await expect(page.locator(locators.architectureContent)).toBeVisible();
  });

  test('navigates to docs page when clicking docs link', async ({ page }) => {
    const docsLink = page.locator(locators.docsLink);
    await expect(docsLink).toBeVisible();
    await docsLink.click();

    await expect(page).toHaveURL(/\/docs\/?$/);
    await expect(page).toHaveTitle('API Documentation - Rapid');
    await expect(page.locator(locators.swaggerContainer)).toBeVisible();
  });

  test('back link on architecture page returns to home', async ({ page }) => {
    await page.goto('/architecture');
    await expect(page).toHaveTitle('Architecture - Rapid');

    const backLink = page.locator(locators.homeLink);
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle('Rapid');
  });

  test('back link on docs page returns to home', async ({ page }) => {
    await page.goto('/docs');
    await expect(page).toHaveTitle('API Documentation - Rapid');

    const backLink = page.locator(locators.homeLink);
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle('Rapid');
  });

  test('can navigate between all pages in sequence', async ({ page }) => {
    await page.locator(locators.architectureLink).click();
    await expect(page).toHaveTitle('Architecture - Rapid');

    await page.locator(locators.homeLink).click();
    await expect(page).toHaveTitle('Rapid');

    await page.locator(locators.docsLink).click();
    await expect(page).toHaveTitle('API Documentation - Rapid');

    await page.locator(locators.homeLink).click();
    await expect(page).toHaveTitle('Rapid');
  });

  test('direct URL navigation works for architecture page', async ({
    page,
  }) => {
    await page.goto('/architecture');
    await expect(page).toHaveTitle('Architecture - Rapid');
    await expect(page.locator(locators.architectureContent)).toBeVisible();
  });

  test('direct URL navigation works for docs page', async ({ page }) => {
    await page.goto('/docs');
    await expect(page).toHaveTitle('API Documentation - Rapid');
    await expect(page.locator(locators.swaggerContainer)).toBeVisible();
  });

  test('navigation preserves theme setting', async ({ page }) => {
    const themeSwitcher = page.locator(locators.themeSwitcher);
    await expect(themeSwitcher).toBeVisible();

    const htmlBefore = page.locator('html');
    const initialTheme = await htmlBefore.getAttribute('class');

    await page.locator(locators.architectureLink).click();
    await expect(page).toHaveTitle('Architecture - Rapid');

    const htmlAfter = page.locator('html');
    const themeAfter = await htmlAfter.getAttribute('class');
    expect(themeAfter).toBe(initialTheme);
  });
});
