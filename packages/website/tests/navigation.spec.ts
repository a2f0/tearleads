import { expect, test } from '@playwright/test';

const locators = {
  architectureLink: 'main a[href="/docs/architecture"]',
  docsLink: 'main a[href="/docs/api"]',
  homeLink: 'header a[href="/"]',
  architectureContent: '[data-testid="architecture-content"]',
  swaggerContainer: '.swagger-ui-container',
  settingsButton: '[data-testid="settings-button"]',
  productsDropdown: '.nav-dropdown:has(button:text("Products"))',
  docsDropdown: '.nav-dropdown:has(button:text("Docs"))',
  dropdownMenu: '.nav-dropdown-menu',
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

    await expect(page).toHaveURL(/\/docs\/architecture\/?$/);
    await expect(page).toHaveTitle('Architecture - Rapid');
    await expect(page.locator(locators.architectureContent)).toBeVisible();
  });

  test('navigates to docs page when clicking docs link', async ({ page }) => {
    const docsLink = page.locator(locators.docsLink);
    await expect(docsLink).toBeVisible();
    await docsLink.click();

    await expect(page).toHaveURL(/\/docs\/api\/?$/);
    await expect(page).toHaveTitle('API Documentation - Rapid');
    await expect(page.locator(locators.swaggerContainer)).toBeVisible();
  });

  test('back link on architecture page returns to home', async ({ page }) => {
    await page.goto('/docs/architecture');
    await expect(page).toHaveTitle('Architecture - Rapid');

    const backLink = page.locator(locators.homeLink);
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle('Rapid');
  });

  test('back link on docs page returns to home', async ({ page }) => {
    await page.goto('/docs/api');
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
    await page.goto('/docs/architecture');
    await expect(page).toHaveTitle('Architecture - Rapid');
    await expect(page.locator(locators.architectureContent)).toBeVisible();
  });

  test('direct URL navigation works for docs page', async ({ page }) => {
    await page.goto('/docs/api');
    await expect(page).toHaveTitle('API Documentation - Rapid');
    await expect(page.locator(locators.swaggerContainer)).toBeVisible();
  });

  test('navigation preserves theme setting', async ({ page }) => {
    const settingsButton = page.locator(locators.settingsButton);
    await expect(settingsButton).toBeVisible();

    const htmlBefore = page.locator('html');
    const initialTheme = await htmlBefore.getAttribute('class');

    await page.locator(locators.architectureLink).click();
    await expect(page).toHaveTitle('Architecture - Rapid');

    const htmlAfter = page.locator('html');
    const themeAfter = await htmlAfter.getAttribute('class');
    expect(themeAfter).toBe(initialTheme);
  });
});

test.describe('Dropdown Menu Hover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 1024, height: 768 });
  });

  test('Products dropdown menu appears on hover', async ({ page }) => {
    const productsDropdown = page.locator(locators.productsDropdown);
    const dropdownMenu = productsDropdown.locator(locators.dropdownMenu);

    await expect(dropdownMenu).toBeHidden();

    await productsDropdown.hover();
    await expect(dropdownMenu).toBeVisible();

    await expect(dropdownMenu.locator('a[href="/products/cli"]')).toBeVisible();
    await expect(
      dropdownMenu.locator('a[href="/products/desktop"]')
    ).toBeVisible();
  });

  test('Docs dropdown menu appears on hover', async ({ page }) => {
    const docsDropdown = page.locator(locators.docsDropdown);
    const dropdownMenu = docsDropdown.locator(locators.dropdownMenu);

    await expect(dropdownMenu).toBeHidden();

    await docsDropdown.hover();
    await expect(dropdownMenu).toBeVisible();

    await expect(
      dropdownMenu.locator('a[href="/docs/architecture"]')
    ).toBeVisible();
    await expect(dropdownMenu.locator('a[href="/docs/api"]')).toBeVisible();
  });

  test('can hover from Products trigger to menu item and click', async ({
    page,
  }) => {
    const productsDropdown = page.locator(locators.productsDropdown);
    const dropdownMenu = productsDropdown.locator(locators.dropdownMenu);
    const cliLink = dropdownMenu.locator('a[href="/products/cli"]');

    await productsDropdown.hover();
    await expect(dropdownMenu).toBeVisible();

    await cliLink.hover();
    await expect(dropdownMenu).toBeVisible();

    await cliLink.click();
    await expect(page).toHaveURL(/\/products\/cli\/?$/);
  });

  test('can hover from Docs trigger to menu item and click', async ({
    page,
  }) => {
    const docsDropdown = page.locator(locators.docsDropdown);
    const dropdownMenu = docsDropdown.locator(locators.dropdownMenu);
    const architectureLink = dropdownMenu.locator('a[href="/docs/architecture"]');

    await docsDropdown.hover();
    await expect(dropdownMenu).toBeVisible();

    await architectureLink.hover();
    await expect(dropdownMenu).toBeVisible();

    await architectureLink.click();
    await expect(page).toHaveURL(/\/docs\/architecture\/?$/);
  });

  test('dropdown menu hides when mouse leaves', async ({ page }) => {
    const productsDropdown = page.locator(locators.productsDropdown);
    const dropdownMenu = productsDropdown.locator(locators.dropdownMenu);

    await productsDropdown.hover();
    await expect(dropdownMenu).toBeVisible();

    await page.locator('body').hover({ position: { x: 0, y: 0 } });
    await expect(dropdownMenu).toBeHidden();
  });
});
