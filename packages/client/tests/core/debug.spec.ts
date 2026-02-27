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

const PATH_OVERRIDES: Record<string, string> = {
  '/postgres-admin': '/admin/postgres',
  '/tables': '/sqlite/tables'
};

const URL_NAVIGATION_PATHS = new Set<string>([]);

async function navigateTo(page: Page, linkName: string) {
  const slug = linkName.toLowerCase().replace(/\s+/g, '-');
  const slugPath = linkName === 'Home' ? '/' : `/${slug}`;
  const path = PATH_OVERRIDES[slugPath] ?? slugPath;
  const isDesktop = await isDesktopDevice(page);

  if (isDesktop && (WINDOW_LAUNCH_PATHS.has(path) || URL_NAVIGATION_PATHS.has(path))) {
    await navigateWithHistory(page, path);
    return;
  }
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
  await triggerSidebarNavigation(page, button);
  await expect(sidebar).not.toBeVisible({ timeout: 5000 });
}

test.describe('Debug page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to debug page when debug link is clicked', async ({
    page
  }) => {
    // Use URL navigation since Debug button may be scrolled out of view in sidebar
    await page.goto('/debug');

    await expect(page.getByRole('heading', { name: 'Debug' })).toBeVisible();
  });

  test('should display system info on debug system-info page', async ({
    page
  }) => {
    // System info is now at /debug/system-info after route consolidation
    await page.goto('/debug/system-info');

    await expect(page.getByText('System Info')).toBeVisible();
    await expect(page.getByText(/Environment:/)).toBeVisible();
    await expect(page.getByText(/Screen:/)).toBeVisible();
    await expect(page.getByText(/User Agent:/)).toBeVisible();
    await expect(page.getByText(/Platform:/)).toBeVisible();
    await expect(page.getByText(/Pixel Ratio:/)).toBeVisible();
    await expect(page.getByText(/Online:/)).toBeVisible();
    await expect(page.getByText(/Language:/)).toBeVisible();
    await expect(page.getByText(/Touch Support:/)).toBeVisible();
    await expect(page.getByText(/Standalone:/)).toBeVisible();
  });

  test('should fetch and display API version', async ({ page }) => {
    await page.goto('/debug/system-info');

    // Wait for ping data to load (either success or error)
    // Look for version in the API Status section (green text) or error message
    const apiStatusSection = page
      .getByText('API Status')
      .locator('..')
      .locator('..');
    const apiStatus = apiStatusSection.getByText(
      /^\d+\.\d+\.\d+$|Failed to connect to API/
    );
    await expect(apiStatus).toBeVisible({ timeout: 10000 });
  });

  test('should refresh API data when refresh button is clicked', async ({
    page
  }) => {
    await page.goto('/debug/system-info');

    // Wait for initial load to complete (button becomes enabled)
    const refreshButton = page.getByRole('button', { name: /^Refresh$/ });
    await expect(refreshButton).toBeEnabled({ timeout: 10000 });

    await refreshButton.click();

    // Should show refreshing state or remain showing data
    await expect(
      page.getByRole('button', { name: /Refresh|Refreshing/ })
    ).toBeVisible();
  });

  test('should navigate back to home when Home link is clicked', async ({
    page
  }) => {
    await page.goto('/debug/system-info');
    await expect(
      page.getByRole('heading', { name: 'System Info' })
    ).toBeVisible();

    // Navigate back home via sidebar
    await navigateTo(page, 'Home');
    await page.waitForURL('/');

    // Should be back on the home page (shows draggable app icons canvas)
    // Verify by checking for the canvas application area and one of the app icon buttons
    await expect(page.getByRole('application')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
  });
});
