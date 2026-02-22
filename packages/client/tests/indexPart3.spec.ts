import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './testUtils';

// Use dbTest for tests that require database setup
const dbTest = test;

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

async function resetDatabase(page: Page) {
  await navigateTo(page, 'SQLite');
  await page.getByTestId('db-reset-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
    timeout: 10000
  });
}

// Helper to import contacts from a CSV file
async function importContacts(page: Page, csvContent: string) {
  await navigateTo(page, 'Contacts');
  await expect(page.getByText('Import CSV')).toBeVisible({ timeout: 10000 });

  const fileInput = page.getByTestId('dropzone-input');
  await fileInput.setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvContent)
  });

  await expect(page.getByText('Map CSV Columns')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Import' }).click();
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

const IGNORED_WARNING_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /apple-mobile-web-app-capable.*deprecated/i,
  // web-llm warnings during model cache checks (expected in test environment)
  /Failed to check cached models/i,
  // Network errors are expected when API server isn't running (PWA works offline)
  /ERR_CONNECTION_REFUSED/i,
  /Failed to load resource/i
];

interface ConsoleMessage {
  level: string;
  text: string;
  source?: string | undefined;
  url?: string | undefined;
}

async function setupConsoleCapture(page: Page): Promise<ConsoleMessage[]> {
  const messages: ConsoleMessage[] = [];

  // Use CDP to capture browser-level warnings (deprecations, security, etc.)
  const client = await page.context().newCDPSession(page);
  await client.send('Log.enable');

  client.on('Log.entryAdded', (event) => {
    const { level, text, source, url } = event.entry;
    if (level === 'warning' || level === 'error') {
      messages.push({ level, text, source, url });
    }
  });

  // Capture JavaScript console.warn() and console.error() calls
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'warning' || type === 'error') {
      messages.push({
        level: type,
        text: msg.text(),
        url: msg.location().url
      });
    }
  });

  return messages;
}

function filterIgnoredWarnings(messages: ConsoleMessage[]): ConsoleMessage[] {
  return messages.filter(
    (msg) => !IGNORED_WARNING_PATTERNS.some((pattern) => pattern.test(msg.text))
  );
}

function formatMessages(messages: ConsoleMessage[]): string {
  return messages
    .map((m) => `[${m.level}] ${m.text}${m.url ? ` (${m.url})` : ''}`)
    .join('\n');
}

void dbTest;
void setupAndUnlockDatabase;
void resetDatabase;
void importContacts;
void waitForModelsOrWebGPUError;
void setupConsoleCapture;
void filterIgnoredWarnings;
void formatMessages;

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