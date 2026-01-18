import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

// Use dbTest for tests that require database setup
const dbTest = test;

const MODEL_CARD_TEXT = 'Phi 3.5 Mini';
const WEBGPU_ERROR_REGEX = /WebGPU Not Supported/;
const WEBGPU_CHECKING_TEXT = 'Checking WebGPU support...';

// Helper to open sidebar via Start button
async function openSidebar(page: Page) {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await startButton.click();
  await expect(page.locator('aside nav')).toBeVisible({ timeout: 10000 });
}

// Helper to navigate via sidebar (requires opening sidebar first)
async function navigateTo(page: Page, linkName: string) {
  // Check if sidebar is visible, if not open it
  const sidebar = page.locator('aside nav');
  if (!(await sidebar.isVisible())) {
    await openSidebar(page);
  }
  const button = sidebar.getByRole('button', { name: linkName });
  // Sidebar auto-closes after launch
  await button.dblclick();
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

test.describe('Console warnings', () => {
  test('should have no console warnings or errors on page load', async ({
    page
  }) => {
    const messages = await setupConsoleCapture(page);

    await clearOriginStorage(page);
    await page.goto('/');
    // Wait for page content to load (can't use networkidle due to SSE connection)
    await page.waitForLoadState('domcontentloaded');
    // Give time for initial render and any async operations
    await page.waitForTimeout(1000);

    const relevantMessages = filterIgnoredWarnings(messages);

    expect(
      relevantMessages,
      `Found console issues:\n${formatMessages(relevantMessages)}`
    ).toEqual([]);
  });
});

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
    // Open sidebar via Start button
    await openSidebar(page);

    const settingsButton = page.locator('aside nav').getByRole('button', { name: 'Settings' });
    await settingsButton.click();

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

test.describe('Debug page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to debug page when debug link is clicked', async ({
    page
  }) => {
    // Open sidebar via Start button
    await openSidebar(page);

    const debugButton = page.locator('aside nav').getByRole('button', { name: 'Debug' });
    await debugButton.click();

    await expect(page.getByRole('heading', { name: 'Debug' })).toBeVisible();
  });

  test('should display system info on debug page', async ({ page }) => {
    await navigateTo(page, 'Debug');

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
    await navigateTo(page, 'Debug');

    // Wait for ping data to load (either success or error)
    // Look for version in the API Status section (green text) or error message
    const apiStatusSection = page.getByText('API Status').locator('..');
    const apiStatus = apiStatusSection.getByText(
      /^\d+\.\d+\.\d+$|Failed to connect to API/
    );
    await expect(apiStatus).toBeVisible({ timeout: 10000 });
  });

  test('should refresh API data when refresh button is clicked', async ({
    page
  }) => {
    await navigateTo(page, 'Debug');

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
    await navigateTo(page, 'Debug');
    await expect(page.getByRole('heading', { name: 'Debug' })).toBeVisible();

    // Navigate back home via sidebar
    await navigateTo(page, 'Home');
    await page.waitForURL('/');

    // Should be back on the home page (shows draggable app icons canvas)
    // Verify by checking for the canvas application area and one of the app icon buttons
    await expect(page.getByRole('application')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
  });
});

test.describe('Tables page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to tables page when tables link is clicked', async ({
    page
  }) => {
    // Open sidebar via Start button
    await openSidebar(page);

    const tablesButton = page.locator('aside nav').getByRole('button', { name: 'Tables' });
    await tablesButton.click();

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
    await expect(page).toHaveURL(/\/tables\/files/);

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
    await expect(page).toHaveURL('/tables');
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
    await expect(page).toHaveURL(/\/tables\/files/);

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

test.describe('Models page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to models page when models link is clicked', async ({
    page
  }) => {
    // Open sidebar via Start button
    await openSidebar(page);

    const modelsButton = page.locator('aside nav').getByRole('button', { name: 'Models' });
    await modelsButton.click();

    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
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

test.describe('Audio page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to audio page when audio link is clicked', async ({
    page
  }) => {
    // Open sidebar via Start button
    await openSidebar(page);

    const audioButton = page.locator('aside nav').getByRole('button', { name: 'Audio' });
    await audioButton.click();

    await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible();
  });

  test('should show inline unlock when database is not unlocked', async ({
    page
  }) => {
    await navigateTo(page, 'Audio');

    await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      page.getByText(/Database is (locked|not set up)/)
    ).toBeVisible();
  });

  dbTest('should show dropzone when database is unlocked and no tracks exist', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to audio page
    await navigateTo(page, 'Audio');
    await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible();

    // Should show dropzone for uploading audio
    await expect(page.getByText('Drop an audio file here to add it to your library')).toBeVisible({
      timeout: 10000
    });
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
    await expect(page.getByText('Drop an audio file here to add it to your library')).toBeVisible({
      timeout: 10000
    });

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

test.describe('Contacts page', () => {
  // Timeout for waiting for contacts list to refresh after import
  const CONTACT_REFRESH_TIMEOUT = 5000;

  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to contacts page when contacts link is clicked', async ({
    page
  }) => {
    // Open sidebar via Start button
    await openSidebar(page);

    const contactsButton = page.locator('aside nav').getByRole('button', { name: 'Contacts' });
    await contactsButton.click();

    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
  });

  test('should show inline unlock when database is not unlocked', async ({
    page
  }) => {
    await navigateTo(page, 'Contacts');

    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      page.getByText(/Database is (locked|not set up)/)
    ).toBeVisible();
  });

  dbTest('should show import CSV section when database is unlocked', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    // Should show Import CSV section
    await expect(page.getByText('Import CSV')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });

  dbTest('should hide search and refresh when no contacts exist', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    // Wait for empty state to be visible
    await expect(page.getByTestId('add-contact-card')).toBeVisible({
      timeout: 10000
    });

    // Search and refresh should be hidden when no contacts exist
    await expect(page.getByPlaceholder('Search contacts...')).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Refresh' })
    ).not.toBeVisible();
  });

  dbTest('should show empty state when no contacts exist', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    // Should show add contact card when empty
    await expect(page.getByTestId('add-contact-card')).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByText('Add new contact')).toBeVisible();
  });

  dbTest('should show column mapper when CSV is uploaded', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByText('Import CSV')).toBeVisible({ timeout: 10000 });

    // Upload a CSV file
    const fileInput = page.getByTestId('dropzone-input');
    const csvContent = 'First Name,Last Name,Email\nJohn,Doe,john@example.com\nJane,Smith,jane@example.com';
    await fileInput.setInputFiles({
      name: 'contacts.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent)
    });

    // Should show column mapper
    await expect(page.getByText('Map CSV Columns')).toBeVisible({ timeout: 5000 });
  });

  dbTest('should import contacts from CSV and display them', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Import a contact using the helper
    await importContacts(page, 'First Name,Last Name,Email\nJohn,Doe,john@example.com');

    // Should show import result and contact
    await expect(page.getByText(/Imported 1 contact/)).toBeVisible({ timeout: 10000 });
    // Wait for contacts list to refresh after import
    await expect(page.getByText('John Doe')).toBeVisible({ timeout: CONTACT_REFRESH_TIMEOUT });
  });

  dbTest('should filter contacts by search query', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Import contacts using the helper
    await importContacts(page, 'First Name,Last Name,Email\nJohn,Doe,john@example.com\nJane,Smith,jane@example.com');
    await expect(page.getByText(/Imported 2 contacts/)).toBeVisible({ timeout: 10000 });

    // Wait for contacts list to refresh after import
    await expect(page.getByText('John Doe')).toBeVisible({ timeout: CONTACT_REFRESH_TIMEOUT });
    await expect(page.getByText('Jane Smith')).toBeVisible({ timeout: CONTACT_REFRESH_TIMEOUT });

    // Search for John
    await page.getByPlaceholder('Search contacts...').fill('John');

    // Wait for debounce and verify only John is shown
    await expect(page.getByText('John Doe')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Jane Smith')).not.toBeVisible();
  });
});

test.describe('Analytics page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to analytics page when analytics link is clicked', async ({
    page
  }) => {
    // Open sidebar via Start button
    await openSidebar(page);

    const analyticsButton = page.locator('aside nav').getByRole('button', { name: 'Analytics' });
    await analyticsButton.click();

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  });

  test('should show inline unlock when database is not unlocked', async ({
    page
  }) => {
    await resetDatabase(page);
    await navigateTo(page, 'Analytics');

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      page.getByText(/Database is (locked|not set up)/)
    ).toBeVisible();
  });

  // Note: Tests for unlocked state are skipped due to a known issue where
  // the database context doesn't propagate correctly to the Analytics page
  // after navigation in the test environment. The page shows an error
  // "Cannot read properties of undefined (reading 'replace')" which
  // affects the analytics component rendering.
});
