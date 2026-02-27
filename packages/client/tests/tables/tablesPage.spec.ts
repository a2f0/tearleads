import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

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

// Helper to reset, setup, and unlock the database
async function setupAndUnlockDatabase(page: Page, password = 'testpassword123') {
  await navigateTo(page, 'SQLite');
  await page.getByTestId('db-reset-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
    timeout: 10000
  });
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
    timeout: 10000
  });
}

test.describe('Tables page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to tables page when tables link is clicked', async ({
    page
  }) => {
    // Use URL navigation since Tables opens as floating window on desktop
    await navigateTo(page, 'Tables');

    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });

  test('should show inline unlock when database is not unlocked', async ({
    page
  }) => {
    await navigateTo(page, 'Tables');

    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      page.getByText(/Database is (locked|not set up)/)
    ).toBeVisible();
  });

  dbTest('should show tables list when database is unlocked', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to tables page
    await navigateTo(page, 'Tables');
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();

    // Should show tables (at least the schema tables)
    await expect(page.getByText('user_settings')).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByText('schema_migrations')).toBeVisible();

    // Should show row counts
    await expect(page.getByText(/\d+ rows?/).first()).toBeVisible();
  });

  dbTest('should refresh tables list when refresh button is clicked', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to tables page
    await navigateTo(page, 'Tables');
    await expect(page.getByText('user_settings')).toBeVisible({
      timeout: 10000
    });

    // Click refresh button
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible();
    await refreshButton.click();

    // Tables should still be visible after refresh
    await expect(page.getByText('user_settings')).toBeVisible();
  });

  dbTest('should navigate to table rows view and display file data', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to Files page using client-side navigation (preserves db session)
    await navigateTo(page, 'Files');
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
    const fileInput = page.getByTestId('dropzone-input');
    // Use a minimal valid PNG (1x1 transparent pixel) for file type detection
    const pngMagicBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth, color type, etc.
      0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
      0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // compressed data
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
      0xae, 0x42, 0x60, 0x82
    ]);
    await fileInput.setInputFiles({
      name: 'test-file.png',
      mimeType: 'image/png',
      buffer: pngMagicBytes
    });

    // Wait for file to appear in list
    await expect(page.getByText('test-file.png', { exact: true })).toBeVisible({
      timeout: 10000
    });

    // Navigate to tables page
    await navigateTo(page, 'Tables');
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();

    // Wait for files table to appear and click it (use link with table name)
    const filesTableLink = page.getByRole('link', { name: /files.*\d+\s+rows?/i });
    await expect(filesTableLink).toBeVisible({ timeout: 10000 });
    await filesTableLink.click();

    // Should be on table rows page
    await expect(page).toHaveURL(/\/sqlite\/tables\/files/);

    // Should show back link
    await expect(page.getByText('Back to Tables')).toBeVisible();

    // Should show table name in header
    await expect(
      page.getByRole('heading', { name: 'files', exact: true })
    ).toBeVisible();

    // Should show column headers as sortable buttons (virtualized div-based layout)
    // Note: id column is hidden by default
    await expect(page.getByRole('button', { name: 'name' })).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByRole('button', { name: 'size' })).toBeVisible();

    // Should show row count (VirtualListStatus shows "Viewing X-Y of Z rows")
    await expect(page.getByText(/Viewing \d+-\d+ of \d+ rows?/)).toBeVisible({
      timeout: 10000
    });

    // Should show our uploaded file data
    await expect(page.getByText('test-file.png', { exact: true })).toBeVisible();

    // Click back to return to tables list
    await page.getByText('Back to Tables').click();
    await expect(page).toHaveURL('/sqlite/tables');
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });

  dbTest('should toggle document view to show JSON format', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to Files page and upload a file
    await navigateTo(page, 'Files');
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
    const fileInput = page.getByTestId('dropzone-input');
    // Use a minimal valid PNG for file type detection
    const pngMagicBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
      0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54,
      0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82
    ]);
    await fileInput.setInputFiles({
      name: 'doc-view-test.png',
      mimeType: 'image/png',
      buffer: pngMagicBytes
    });

    await expect(page.getByText('doc-view-test.png', { exact: true })).toBeVisible({
      timeout: 10000
    });

    // Navigate to tables and open files table (use link with table name)
    await navigateTo(page, 'Tables');
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
    const filesTableLink = page.getByRole('link', { name: /files.*\d+\s+rows?/i });
    await expect(filesTableLink).toBeVisible({ timeout: 10000 });
    await filesTableLink.click();
    await expect(page).toHaveURL(/\/sqlite\/tables\/files/);

    // Initially should show table view with sortable column header buttons
    // (virtualized div-based layout uses buttons, not columnheaders)
    await expect(page.getByRole('button', { name: 'name' })).toBeVisible();
    await expect(page.locator('pre')).not.toBeVisible();

    // Click the document view toggle button (Braces icon)
    await page.getByRole('button', { name: 'Toggle document view' }).click();

    // Should now show JSON document format in pre tags (wait for render)
    const preElement = page.locator('pre').first();
    await expect(preElement).toBeVisible({ timeout: 10000 });

    // Should contain the file name in JSON format
    await expect(preElement).toContainText('"name": "doc-view-test.png"');

    // Column header buttons should not be visible in document view
    await expect(page.getByRole('button', { name: 'name' })).not.toBeVisible();

    // Toggle back to table view
    await page.getByRole('button', { name: 'Toggle document view' }).click();

    // Should show table view again
    await expect(page.getByRole('button', { name: 'name' })).toBeVisible();
    await expect(page.locator('pre')).not.toBeVisible();
  });
});
