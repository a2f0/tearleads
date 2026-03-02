import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

// Use dbTest for tests that require database setup
const dbTest = test;
const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;
const TRANSIENT_DB_ERROR_PATTERN =
  /SQLITE_NOTADB|already initialized|initialization state is invalid/i;

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

async function waitForDbResult(page: Page) {
  await expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    /success|error/,
    { timeout: DB_OPERATION_TIMEOUT }
  );
}

async function ensureDatabaseUnlocked(page: Page, password = TEST_PASSWORD) {
  await navigateTo(page, 'SQLite');
  await expect(page.getByTestId('db-status')).not.toHaveText('Loading...', {
    timeout: DB_OPERATION_TIMEOUT
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByTestId('db-reset-button').click();
    await waitForDbResult(page);

    const resetResult = page.getByTestId('db-test-result');
    const resetStatus = await resetResult.getAttribute('data-status');
    if (resetStatus === 'error') {
      const resetErrorText = (await resetResult.textContent()) ?? '';
      if (!TRANSIENT_DB_ERROR_PATTERN.test(resetErrorText) || attempt === 1) {
        throw new Error(`Database reset failed: ${resetErrorText}`);
      }
      continue;
    }

    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up', {
      timeout: DB_OPERATION_TIMEOUT
    });
    await page.getByTestId('db-password-input').fill(password);
    await page.getByTestId('db-setup-button').click();
    await waitForDbResult(page);

    const setupResult = page.getByTestId('db-test-result');
    const setupStatus = await setupResult.getAttribute('data-status');
    if (setupStatus === 'success') {
      await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
        timeout: DB_OPERATION_TIMEOUT
      });
      return;
    }

    const setupErrorText = (await setupResult.textContent()) ?? '';
    if (!TRANSIENT_DB_ERROR_PATTERN.test(setupErrorText) || attempt === 1) {
      throw new Error(`Database setup failed: ${setupErrorText}`);
    }
  }

  throw new Error('Database setup did not complete after retries.');
}

async function waitForUploadedFileRow(page: Page, fileName: string) {
  const row = page
    .locator('[data-slot="list-row"]')
    .filter({ hasText: fileName })
    .filter({ has: page.getByTitle('Download') })
    .first();

  if (await row.isVisible().catch(() => false)) {
    return row;
  }

  try {
    await expect(row).toBeVisible({ timeout: 10000 });
    return row;
  } catch {
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    if (await refreshButton.isEnabled().catch(() => false)) {
      await refreshButton.click();
    }
    await expect(row).toBeVisible({ timeout: 10000 });
    return row;
  }
}

async function navigateToFilesAndWaitReady(page: Page) {
  await navigateTo(page, 'Files');
  const refreshButton = page.getByRole('button', { name: 'Refresh' });
  await expect(refreshButton).toBeEnabled({ timeout: 10000 });
}

async function uploadFileAndWaitForRow(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer }
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByTestId('dropzone-input').setInputFiles(file);
    try {
      return await waitForUploadedFileRow(page, file.name);
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await ensureDatabaseUnlocked(page);
      await navigateToFilesAndWaitReady(page);
    }
  }

  throw new Error(`Upload did not succeed for ${file.name}`);
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
    await clearOriginStorage(page);
    await page.goto('/files');
  });

  dbTest('should keep file actions visible on narrow viewport with long names', async ({
    page
  }) => {
    const longName =
      'this-is-a-very-long-file-name-that-should-truncate-and-not-cause-horizontal-scroll.png';

    await ensureDatabaseUnlocked(page);

    // Go to Files page and wait for initial file query to finish.
    await navigateToFilesAndWaitReady(page);

    const row = await uploadFileAndWaitForRow(page, {
      name: longName,
      mimeType: 'image/png',
      buffer: pngMagicBytes
    });
    const nameCell = row.locator('p').first();
    await expect(nameCell).toBeVisible();

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
    await ensureDatabaseUnlocked(page);

    // Go to Files page and wait for initial file query to finish.
    await navigateToFilesAndWaitReady(page);

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
    await ensureDatabaseUnlocked(page);

    // Go to Files page and wait for initial file query to finish.
    await navigateToFilesAndWaitReady(page);

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
    await ensureDatabaseUnlocked(page);

    // Go to Files page and wait for initial file query to finish.
    await navigateToFilesAndWaitReady(page);

    await uploadFileAndWaitForRow(page, {
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
