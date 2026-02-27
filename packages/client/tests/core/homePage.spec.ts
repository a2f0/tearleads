import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

// Helper to open sidebar via Start button
async function openSidebar(page: Page) {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeVisible({ timeout: 10000 });
  if ((await startButton.getAttribute('aria-pressed')) !== 'true') {
    await startButton.click();
  }
  await expect(page.locator('aside nav')).toBeVisible({ timeout: 10000 });
}

async function isDesktopDevice(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const isMobile = window.matchMedia('(max-width: 1023px)').matches;
    const isTouch =
      window.matchMedia('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0;
    return !isMobile && !isTouch;
  });
}

async function navigateWithHistory(page: Page, path: string): Promise<void> {
  await page.evaluate((targetPath) => {
    window.history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function triggerSidebarNavigation(
  _page: Page,
  button: Locator
): Promise<void> {
  // All devices now use single click for sidebar navigation
  await button.click();
}

// All paths that open as floating windows on desktop (matches Sidebar WINDOW_PATHS)
const WINDOW_LAUNCH_PATHS = new Set([
  '/admin/postgres',
  '/admin/redis',
  '/analytics',
  '/audio',
  '/cache-storage',
  '/ai',
  '/console',
  '/contacts',
  '/debug',
  '/docs',
  '/documents',
  '/email',
  '/files',
  '/keychain',
  '/local-storage',
  '/models',
  '/notes',
  '/opfs',
  '/photos',
  '/settings',
  '/sqlite',
  '/sqlite/tables',
  '/videos'
]);

// Override paths where the slug doesn't match the actual route
const PATH_OVERRIDES: Record<string, string> = {
  '/postgres-admin': '/admin/postgres',
  '/tables': '/sqlite/tables'
};

// Pages at the bottom of sidebar that might be scrolled out of view
const URL_NAVIGATION_PATHS = new Set<string>([]);

// Helper to navigate via sidebar or URL navigation
async function navigateTo(page: Page, linkName: string) {
  const slug = linkName.toLowerCase().replace(/\s+/g, '-');
  const slugPath = linkName === 'Home' ? '/' : `/${slug}`;
  // Apply path override if exists (e.g., /tables -> /sqlite/tables)
  const path = PATH_OVERRIDES[slugPath] ?? slugPath;
  const isDesktop = await isDesktopDevice(page);

  // Use URL navigation for window-capable paths or paths that might be scrolled out of view
  if (isDesktop && (WINDOW_LAUNCH_PATHS.has(path) || URL_NAVIGATION_PATHS.has(path))) {
    await navigateWithHistory(page, path);
    return;
  }
  // Check if sidebar is visible, if not open it
  const sidebar = page.locator('aside nav');
  const startButton = page.getByTestId('start-button');
  const isSidebarOpen =
    (await startButton.getAttribute('aria-pressed')) === 'true';
  if (!isSidebarOpen) {
    await openSidebar(page);
  } else {
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  }
  const testId = `${slug}-link`;
  const button = sidebar.getByTestId(testId);
  // Sidebar auto-closes after launch
  await triggerSidebarNavigation(page, button);
  await expect(sidebar).not.toBeVisible({ timeout: 5000 });
}

test.describe('Index page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should load and display the Start button', async ({ page }) => {
    await expect(page).toHaveTitle('Tearleads');

    // Verify Start button is visible (main entry point to navigation)
    const startButton = page.getByTestId('start-button');
    await expect(startButton).toBeVisible();
  });

  test('should have the root element mounted', async ({ page }) => {
    const rootElement = page.locator('#root');
    await expect(rootElement).not.toBeEmpty();

    const appContainer = page.getByTestId('app-container');
    await expect(appContainer).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    await navigateTo(page, 'Settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('should switch themes from settings', async ({ page }) => {
    // Navigate to settings
    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Verify theme selector is visible
    const themeContainer = page.getByTestId('theme-selector-container');
    await expect(themeContainer).toBeVisible();

    // Click dark theme option
    const darkOption = page.getByTestId('theme-option-dark');
    await darkOption.click();

    // Verify dark class is applied
    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveClass(/dark/);

    // Switch to light theme
    const lightOption = page.getByTestId('theme-option-light');
    await lightOption.click();

    // Verify light class is applied
    await expect(htmlElement).toHaveClass(/light/);
  });

  test('should apply correct theme class to html element', async ({ page }) => {
    // Navigate to settings
    await navigateTo(page, 'Settings');

    const htmlElement = page.locator('html');

    // Switch to light theme
    await page.getByTestId('theme-option-light').click();
    await expect(htmlElement).toHaveClass(/light/);
    await expect(htmlElement).not.toHaveClass(/dark/);
    await expect(htmlElement).not.toHaveClass(/tokyo-night/);

    // Switch to dark theme
    await page.getByTestId('theme-option-dark').click();
    await expect(htmlElement).toHaveClass(/dark/);
    await expect(htmlElement).not.toHaveClass(/light/);
    await expect(htmlElement).not.toHaveClass(/tokyo-night/);

    // Switch to Tokyo Night theme
    await page.getByTestId('theme-option-tokyo-night').click();
    await expect(htmlElement).toHaveClass(/tokyo-night/);
    await expect(htmlElement).not.toHaveClass(/light/);
    await expect(htmlElement).not.toHaveClass(/dark/);
  });
});
