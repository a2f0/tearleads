import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Use dbTest for tests that require database setup
const dbTest = test;

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

test.describe('Dropzone layout and file type handling', () => {
  // Minimal valid PNG (1x1 transparent pixel) for file type detection
  const pngMagicBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth, etc.
    0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
    0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // data
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
    0xae, 0x42, 0x60, 0x82
  ]);

  test.beforeEach(async ({ page }) => {
    await page.goto('/files');
  });

  dbTest('should keep file actions visible on narrow viewport with long names', async ({
    page
  }) => {
    const longName =
      'this-is-a-very-long-file-name-that-should-truncate-and-not-cause-horizontal-scroll.png';

    // First unlock the database
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const fileInput = page.getByTestId('dropzone-input');
    await fileInput.setInputFiles({
      name: longName,
      mimeType: 'image/png',
      buffer: pngMagicBytes
    });

    const nameCell = page.getByText(longName, { exact: true });
    await expect(nameCell).toBeVisible();

    const row = page
      .locator('div', { has: nameCell })
      .filter({ has: page.getByTitle('Download') })
      .first();

    await expect(row).toBeVisible();

    // Switch to a narrow viewport to verify mobile layout constraints
    await page.setViewportSize({ width: 360, height: 800 });

    const scrollInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scrollInfo.scrollWidth - scrollInfo.clientWidth).toBeLessThanOrEqual(1);

    const viewportWidth = page.viewportSize()?.width ?? 0;
    expect(viewportWidth).toBeGreaterThan(0);

    const downloadButton = row.getByTitle('Download');
    const deleteButton = row.getByTitle('Delete');

    const [downloadBox, deleteBox] = await Promise.all([
      downloadButton.boundingBox(),
      deleteButton.boundingBox()
    ]);

    expect(downloadBox).not.toBeNull();
    expect(deleteBox).not.toBeNull();

    if (downloadBox && deleteBox) {
      expect(downloadBox.x + downloadBox.width).toBeLessThanOrEqual(
        viewportWidth
      );
      expect(deleteBox.x + deleteBox.width).toBeLessThanOrEqual(viewportWidth);
    }

    const textStyles = await nameCell.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth
      };
    });

    expect(textStyles.overflow).toBe('hidden');
    expect(textStyles.textOverflow).toBe('ellipsis');
    expect(textStyles.whiteSpace).toBe('nowrap');
    expect(textStyles.scrollWidth).toBeGreaterThan(textStyles.clientWidth);
  });

  dbTest('should successfully upload plain text files', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const fileInput = page.getByTestId('dropzone-input');

    // Upload a plain text file (no magic bytes, but text/* types are allowed)
    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is just plain text content')
    });

    // Should show success badge and the file in the list
    await expect(page.getByTestId('upload-success-badge')).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByText('notes.txt')).toBeVisible();
  });

  dbTest('should show error when file type cannot be detected', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const fileInput = page.getByTestId('dropzone-input');

    // Upload a binary file with no magic bytes and non-text MIME type
    await fileInput.setInputFiles({
      name: 'unknown.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('random binary data without magic bytes')
    });

    // Should show error message for unsupported file type
    await expect(page.getByText(/Unable to detect file type/)).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByText('unknown.bin', { exact: true })).toBeVisible();
  });

  dbTest('should show green check badge after successful upload', async ({
    page
  }) => {
    // First unlock the database
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const fileInput = page.getByTestId('dropzone-input');
    await fileInput.setInputFiles({
      name: 'success-badge-test.png',
      mimeType: 'image/png',
      buffer: pngMagicBytes
    });

    // Wait for upload to complete and verify green check badge appears
    await expect(page.getByTestId('upload-success-badge')).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByText('success-badge-test.png')).toBeVisible();
  });
});
