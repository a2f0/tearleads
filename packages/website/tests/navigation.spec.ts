import { expect, test } from '@playwright/test';

const locators = {
  architectureLink: 'main a[href="/docs/architecture"]',
  docsLink: 'main a[href="/docs/api"]',
  homeLink: 'header a[href="/"]',
  architectureContent: '[data-testid="architecture-content"]',
  apiDocsContent: 'text=API Docs',
  settingsButton: '[data-testid="settings-button"]',
  productsDropdown: '.nav-dropdown:has(button:text("Products"))',
  docsDropdown: '.nav-dropdown:has(button:text("Docs"))',
  dropdownMenu: '.nav-dropdown-menu',
};

test.describe('Website Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Root page serves English content directly (no redirect)
    await page.goto('/');
  });

  test('home page loads with correct title', async ({ page }) => {
    // English content is served directly at root (no /en/ prefix)
    await expect(page).toHaveURL(/\/$/);
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
    await expect(page.locator(locators.apiDocsContent)).toBeVisible();
  });

  test('back link on architecture page returns to home', async ({ page }) => {
    await page.goto('/docs/architecture');
    await expect(page).toHaveTitle('Architecture - Rapid');

    const backLink = page.locator(locators.homeLink);
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('Rapid');
  });

  test('back link on docs page returns to home', async ({ page }) => {
    await page.goto('/docs/api');
    await expect(page).toHaveTitle('API Documentation - Rapid');

    const backLink = page.locator(locators.homeLink);
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL(/\/$/);
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
    await expect(page.locator(locators.apiDocsContent)).toBeVisible();
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

const dropdownTests = [
  {
    name: 'Products',
    locator: locators.productsDropdown,
    links: ['a[href="/products/cli"]', 'a[href="/products/desktop"]'],
    clickLink: 'a[href="/products/cli"]',
    expectedUrl: /\/products\/cli\/?$/,
  },
  {
    name: 'Docs',
    locator: locators.docsDropdown,
    links: ['a[href="/docs/architecture"]', 'a[href="/docs/api"]'],
    clickLink: 'a[href="/docs/architecture"]',
    expectedUrl: /\/docs\/architecture\/?$/,
  },
];

test.describe('Dropdown Menu Hover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 1024, height: 768 });
  });

  for (const dropdown of dropdownTests) {
    test(`${dropdown.name} dropdown menu appears on hover`, async ({
      page,
    }) => {
      const dropdownTrigger = page.locator(dropdown.locator);
      const dropdownMenu = dropdownTrigger.locator(locators.dropdownMenu);

      await expect(dropdownMenu).toBeHidden();
      await dropdownTrigger.hover();
      await expect(dropdownMenu).toBeVisible();

      for (const link of dropdown.links) {
        await expect(dropdownMenu.locator(link)).toBeVisible();
      }
    });

    test(`can hover from ${dropdown.name} trigger to menu item and click`, async ({
      page,
    }) => {
      const dropdownTrigger = page.locator(dropdown.locator);
      const dropdownMenu = dropdownTrigger.locator(locators.dropdownMenu);
      const targetLink = dropdownMenu.locator(dropdown.clickLink);

      await dropdownTrigger.hover();
      await expect(dropdownMenu).toBeVisible();

      await targetLink.hover();
      await expect(dropdownMenu).toBeVisible();

      await targetLink.click();
      await expect(page).toHaveURL(dropdown.expectedUrl);
    });
  }

  test('dropdown menu hides when mouse leaves', async ({ page }) => {
    const productsDropdown = page.locator(locators.productsDropdown);
    const dropdownMenu = productsDropdown.locator(locators.dropdownMenu);

    await productsDropdown.hover();
    await expect(dropdownMenu).toBeVisible();

    await page.locator('body').hover({ position: { x: 0, y: 0 } });
    await expect(dropdownMenu).toBeHidden();
  });
});
