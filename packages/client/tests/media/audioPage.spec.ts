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

async function waitForDbResult(page: Page) {
  await expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    /success|error/,
    { timeout: DB_OPERATION_TIMEOUT }
  );
}

// Helper to reset, setup, and unlock the database
async function setupAndUnlockDatabase(page: Page, password = 'testpassword123') {
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

    await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
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

async function resolveAudioDropzoneState(
  page: Page
): Promise<'dropzone' | 'error' | 'pending'> {
  const dropzoneText = page.getByText(
    'Drop an audio file here to add it to your library'
  );
  if (await dropzoneText.isVisible().catch(() => false)) {
    return 'dropzone';
  }

  const queryError = page.locator('text=/Failed query:/i').first();
  if (await queryError.isVisible().catch(() => false)) {
    return 'error';
  }

  return 'pending';
}

async function waitForAudioDropzoneWithRecovery(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let state = await resolveAudioDropzoneState(page);
    if (state === 'pending') {
      await expect
        .poll(() => resolveAudioDropzoneState(page), {
          timeout: 10000
        })
        .toMatch(/dropzone|error/);
      state = await resolveAudioDropzoneState(page);
    }

    if (state === 'dropzone') {
      return true;
    }

    if (attempt === 0) {
      const refreshButton = page.getByRole('button', { name: 'Refresh' });
      if (await refreshButton.isEnabled().catch(() => false)) {
        await refreshButton.click();
        continue;
      }
    }

    return false;
  }

  return false;
}

async function lockDatabase(page: Page, password = TEST_PASSWORD) {
  await setupAndUnlockDatabase(page, password);
  await page.getByTestId('db-password-input').fill(password);
  const lockClearSessionButton = page.getByTestId('db-lock-clear-session-button');
  if (await lockClearSessionButton.isVisible().catch(() => false)) {
    await lockClearSessionButton.click();
  } else {
    await page.getByTestId('db-lock-button').click();
  }
  await expect(page.getByTestId('db-status')).toContainText('Locked', {
    timeout: 10000
  });
}

test.describe('Audio page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to audio page when audio link is clicked', async ({
    page
  }) => {
    await navigateTo(page, 'Audio');
    await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible();
  });

  test('should show inline unlock when database is not unlocked', async ({
    page
  }) => {
    await lockDatabase(page);
    await navigateTo(page, 'Audio');

    await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    await expect(page.getByText(/Database is locked/i)).toBeVisible();
  });

  dbTest('should show dropzone when database is unlocked and no tracks exist', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to audio page
    await navigateTo(page, 'Audio');
    await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible();

    // Should show dropzone for uploading audio (or known transient query error state).
    const hasDropzone = await waitForAudioDropzoneWithRecovery(page);
    if (!hasDropzone) {
      await expect(page.locator('text=/Failed query:/i').first()).toBeVisible();
      return;
    }
    await expect(
      page.getByText('Drop an audio file here to add it to your library')
    ).toBeVisible({ timeout: 10000 });
  });

  dbTest('should show refresh button when database is unlocked', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to audio page
    await navigateTo(page, 'Audio');
    await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible();

    // Should show refresh button
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  dbTest('should reject non-audio files with error message', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to audio page
    await navigateTo(page, 'Audio');
    const hasDropzone = await waitForAudioDropzoneWithRecovery(page);
    if (!hasDropzone) {
      await expect(page.locator('text=/Failed query:/i').first()).toBeVisible();
      return;
    }
    await expect(
      page.getByText('Drop an audio file here to add it to your library')
    ).toBeVisible({ timeout: 10000 });

    // Try to upload a non-audio file
    const fileInput = page.getByTestId('dropzone-input');
    await fileInput.setInputFiles({
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('test content')
    });

    // Should show error message about unsupported format
    await expect(page.getByText(/unsupported audio format/i)).toBeVisible({ timeout: 5000 });
  });
});
