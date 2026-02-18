import { expect, test } from '@playwright/test';

test.describe('Website Smoke', () => {
  test('home page renders core copy', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('Tearleads');
    await expect(page.getByRole('heading', { name: 'Welcome to Tearleads' })).toBeVisible();
  });

  test('architecture page renders doc content', async ({ page }) => {
    await page.goto('/docs/architecture');
    await expect(page).toHaveURL(/\/docs\/architecture\/?$/);
    await expect(page).toHaveTitle('Architecture - Tearleads');
    await expect(page.locator('[data-testid="architecture-content"]')).toBeVisible();
  });

  test('api docs page responds and sets title', async ({ page }) => {
    await page.goto('/docs/api');
    await expect(page).toHaveURL(/\/docs\/api\/?$/);
    await expect(page).toHaveTitle('API Documentation - Tearleads');
    await expect(page.locator('main')).toBeVisible();
  });

  test('licenses page has back link to home', async ({ page }) => {
    await page.goto('/licenses');
    await expect(page).toHaveURL(/\/licenses\/?$/);
    await expect(page).toHaveTitle('Open Source Licenses - Tearleads');
    await expect(page.getByRole('heading', { name: 'Open Source Licenses' })).toBeVisible();

    const backLink = page.getByRole('link', { name: '← Back to Home' });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(/\/$/);
  });
});
