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

test.describe('Dropzone', () => {
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

  test('should display inline unlock when database is not unlocked', async ({ page }) => {
    // When database is not unlocked, dropzone should be hidden and inline unlock shown
    await expect(page.getByTestId('dropzone')).not.toBeVisible();
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      page.getByText(/Database is (locked|not set up)/)
    ).toBeVisible();
  });

  dbTest('should display the dropzone when database is unlocked', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const dropzone = page.getByTestId('dropzone');
    await expect(dropzone).toBeVisible();
    await expect(page.getByText('Drag and drop files here')).toBeVisible();
    await expect(page.getByText('or click to browse')).toBeVisible();
  });

  dbTest('should open file picker when dropzone is clicked (unlocked)', async ({
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

    const dropzone = page.getByTestId('dropzone');

    // Dropzone should not be disabled
    await expect(dropzone).not.toHaveClass(/opacity-50/);

    // Set up a file chooser listener
    const fileChooserPromise = page.waitForEvent('filechooser');

    await dropzone.click();

    const fileChooser = await fileChooserPromise;
    expect(fileChooser).toBeTruthy();
  });

  dbTest('should accept files via file input', async ({ page }) => {
    // First unlock the database (dropzone is hidden when locked)
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const fileInput = page.getByTestId('dropzone-input');

    // Create a test file and set it on the input
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content')
    });

    // Verify the dropzone is still functional after file selection
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });

  dbTest('should show dragging state on dragover (unlocked)', async ({
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

    const dropzone = page.getByTestId('dropzone');

    // Verify initial state
    await expect(dropzone).toHaveAttribute('data-dragging', 'false');

    // Simulate dragover
    await dropzone.dispatchEvent('dragover');

    // Verify dragging state
    await expect(dropzone).toHaveAttribute('data-dragging', 'true');
    await expect(page.getByText('Drop files here')).toBeVisible();
  });

  dbTest('should remove dragging state on dragleave (unlocked)', async ({
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

    const dropzone = page.getByTestId('dropzone');

    // Set dragging state
    await dropzone.dispatchEvent('dragover');
    await expect(dropzone).toHaveAttribute('data-dragging', 'true');

    // Simulate dragleave
    await dropzone.dispatchEvent('dragleave');

    // Verify dragging state removed
    await expect(dropzone).toHaveAttribute('data-dragging', 'false');
  });

  dbTest('should upload file and show completion status', async ({ page }) => {
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
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('test content')
    });

    // Verify file name is displayed during/after upload
    await expect(page.getByText('document.pdf', { exact: true })).toBeVisible();
    // Verify file size is displayed
    await expect(page.getByText(/12 B/)).toBeVisible();
  });

  dbTest('should display formatted file size during upload', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const fileInput = page.getByTestId('dropzone-input');

    // Create a ~1.5KB file
    const content = 'x'.repeat(1536);
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(content)
    });

    // Verify file size is formatted (should show ~1.5 KB)
    await expect(page.getByText(/1\.5 KB/)).toBeVisible();
  });

  dbTest('should upload multiple files', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'SQLite');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go to Files page
    await navigateTo(page, 'Files');

    const fileInput = page.getByTestId('dropzone-input');

    await fileInput.setInputFiles([
      {
        name: 'file1.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('content 1')
      },
      {
        name: 'file2.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('content 2')
      }
    ]);

    await expect(page.getByText('file1.txt', { exact: true })).toBeVisible();
    await expect(page.getByText('file2.txt', { exact: true })).toBeVisible();
  });

  dbTest('should show files in list after upload', async ({ page }) => {
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
      name: 'uploaded-file.png',
      mimeType: 'image/png',
      buffer: pngMagicBytes
    });

    // Wait for upload to complete and verify file appears in the listing
    // The file list auto-refreshes after upload completes
    await expect(page.getByText('uploaded-file.png', { exact: true })).toBeVisible();
  });

});
