import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const MODEL_CARD_TEXT = 'Phi 3.5 Mini';
const WEBGPU_ERROR_REGEX = /WebGPU Not Supported/;
const WEBGPU_CHECKING_TEXT = 'Checking WebGPU support...';

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

type WebGPUState = 'models' | 'error';

async function waitForModelsOrWebGPUError(page: Page): Promise<WebGPUState> {
  const checkingStatus = page.getByText(WEBGPU_CHECKING_TEXT);
  if (await checkingStatus.count()) {
    await checkingStatus.waitFor({ state: 'hidden', timeout: 15000 });
  }

  const supportsWebGPU = await page.evaluate<boolean>(`
    (async () => {
      if (!('gpu' in navigator)) return false;
      try {
        const adapter = await navigator.gpu.requestAdapter();
        return !!adapter;
      } catch {
        return false;
      }
    })()
  `);

  if (supportsWebGPU) {
    const modelCard = page.getByText(MODEL_CARD_TEXT);
    const webGPUError = page.getByText(WEBGPU_ERROR_REGEX);
    await expect(modelCard).toBeVisible({ timeout: 15000 });
    await expect(webGPUError).not.toBeVisible();
    return 'models';
  }

  const webGPUError = page.getByText(WEBGPU_ERROR_REGEX);
  const modelCard = page.getByText(MODEL_CARD_TEXT);
  await expect(webGPUError).toBeVisible({ timeout: 15000 });
  await expect(modelCard).not.toBeVisible();
  return 'error';
}

test.describe('Models page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to models page when models link is clicked', async ({
    page
  }) => {
    // Use URL navigation since Models opens as floating window on desktop
    await navigateTo(page, 'Models');

    await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  });

  test('should display model cards or WebGPU not supported message', async ({ page }) => {
    await navigateTo(page, 'Models');

    const webGPUState = await waitForModelsOrWebGPUError(page);

    if (webGPUState === 'models') {
      await expect(page.getByText(MODEL_CARD_TEXT)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('SmolVLM 256M')).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('PaliGemma 2 3B')).toBeVisible({ timeout: 15000 });
    } else {
      await expect(page.getByText(WEBGPU_ERROR_REGEX)).toBeVisible();
    }
  });

  test('should show model sizes or WebGPU not supported message', async ({ page }) => {
    await navigateTo(page, 'Models');

    const webGPUState = await waitForModelsOrWebGPUError(page);

    if (webGPUState === 'models') {
      await expect(page.getByText(/~2GB/)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/~500MB/)).toBeVisible({ timeout: 15000 });
    } else {
      await expect(page.getByText(WEBGPU_ERROR_REGEX)).toBeVisible();
    }
  });

  test('should show description text or WebGPU not supported message', async ({ page }) => {
    await navigateTo(page, 'Models');

    const webGPUState = await waitForModelsOrWebGPUError(page);

    if (webGPUState === 'models') {
      await expect(page.getByText(/Download and run LLMs locally/)).toBeVisible({
        timeout: 15000
      });
    } else {
      await expect(page.getByText(WEBGPU_ERROR_REGEX)).toBeVisible();
    }
  });

  test('should show download buttons for models not cached when WebGPU is supported', async ({
    page
  }) => {
    await navigateTo(page, 'Models');

    const webGPUState = await waitForModelsOrWebGPUError(page);
    if (webGPUState === 'error') {
      return;
    }

    // Should have Download buttons (models not cached in test environment)
    const downloadButtons = page.getByRole('button', { name: /Download/i });
    await expect(downloadButtons.first()).toBeVisible();
  });

  test('should persist cached model status across page reload when WebGPU is supported', async ({
    page
  }) => {
    await navigateTo(page, 'Models');

    const webGPUState = await waitForModelsOrWebGPUError(page);
    if (webGPUState === 'error') {
      return;
    }

    // Get the initial state of buttons (should be Download since not cached)
    const initialDownloadButtons = await page.getByRole('button', { name: /Download/i }).count();

    // Reload the page
    await page.reload();

    // Wait for models page to load again
    await expect(page.getByText(MODEL_CARD_TEXT)).toBeVisible({
      timeout: 10000
    });

    // Count buttons again - should be the same since no model was actually downloaded
    const afterReloadDownloadButtons = await page.getByRole('button', { name: /Download/i }).count();

    // The button count should be consistent (cache detection is working)
    expect(afterReloadDownloadButtons).toBe(initialDownloadButtons);
  });

  test('should show appropriate WebGPU status', async ({ page }) => {
    await navigateTo(page, 'Models');

    await expect.poll(async () => {
      const hasModelCards = await page.getByText(MODEL_CARD_TEXT).isVisible();
      const hasWebGPUError = await page.getByText(WEBGPU_ERROR_REGEX).isVisible();
      return hasModelCards !== hasWebGPUError;
    }).toBe(true);
  });
});
