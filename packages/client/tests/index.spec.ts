import { test, expect, Page } from '@playwright/test';

// Helper to navigate via sidebar (visible on desktop viewport)
async function navigateTo(page: Page, linkName: string) {
  const link = page.locator('aside nav').getByRole('link', { name: linkName });
  await link.click();
}

const IGNORED_WARNING_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /apple-mobile-web-app-capable.*deprecated/i,
  // web-llm warnings during model cache checks (expected in test environment)
  /Failed to check cached models/i
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

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const relevantMessages = filterIgnoredWarnings(messages);

    expect(
      relevantMessages,
      `Found console issues:\n${formatMessages(relevantMessages)}`
    ).toEqual([]);
  });
});

test.describe('Index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load and display the main heading', async ({ page }) => {
    await expect(page).toHaveTitle('Tearleads');

    const heading = page.getByRole('heading', { name: 'Tearleads', level: 1 });
    await expect(heading).toBeVisible();
  });

  test('should have the root element mounted', async ({ page }) => {
    const rootElement = page.locator('#root');
    await expect(rootElement).not.toBeEmpty();

    const appContainer = page.getByTestId('app-container');
    await expect(appContainer).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    const settingsLink = page.locator('aside nav').getByRole('link', { name: 'Settings' });
    await expect(settingsLink).toBeVisible();

    await settingsLink.click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('should toggle dark mode from settings', async ({ page }) => {
    // Navigate to settings
    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const toggleSwitch = page.getByTestId('dark-mode-switch');
    await expect(toggleSwitch).toBeVisible();

    // Get initial state
    const htmlElement = page.locator('html');
    const initialDark = await htmlElement.evaluate((el) =>
      el.classList.contains('dark')
    );

    // Toggle
    await toggleSwitch.click();

    // Verify class changed
    const afterToggle = await htmlElement.evaluate((el) =>
      el.classList.contains('dark')
    );
    expect(afterToggle).toBe(!initialDark);
  });

  test('should change background color when dark mode is toggled', async ({
    page
  }) => {
    // Navigate to settings
    await navigateTo(page, 'Settings');

    const toggleSwitch = page.getByTestId('dark-mode-switch');
    const body = page.locator('body');

    // Get initial background color
    const initialBgColor = await body.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );

    // Toggle dark mode
    await toggleSwitch.click();

    // Get new background color
    const newBgColor = await body.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );

    // Background colors should be different
    expect(newBgColor).not.toBe(initialBgColor);

    // Toggle back
    await toggleSwitch.click();

    // Should return to original color
    const restoredBgColor = await body.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );
    expect(restoredBgColor).toBe(initialBgColor);
  });
});

test.describe('Dropzone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the dropzone', async ({ page }) => {
    const dropzone = page.getByTestId('dropzone');
    await expect(dropzone).toBeVisible();
    await expect(page.getByText('Drag and drop files here')).toBeVisible();
    await expect(page.getByText('or click to browse')).toBeVisible();
  });

  test('should be disabled when database is locked', async ({ page }) => {
    const dropzone = page.getByTestId('dropzone');
    // Dropzone should be disabled (has opacity-50 class) when database is locked
    await expect(dropzone).toHaveClass(/opacity-50/);
    await expect(
      page.getByText('Unlock the database to upload files')
    ).toBeVisible();
  });

  test('should open file picker when dropzone is clicked (unlocked)', async ({
    page
  }) => {
    // First unlock the database
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go back to home
    await page.getByRole('link', { name: 'Tearleads' }).click();

    const dropzone = page.getByTestId('dropzone');

    // Dropzone should not be disabled
    await expect(dropzone).not.toHaveClass(/opacity-50/);

    // Set up a file chooser listener
    const fileChooserPromise = page.waitForEvent('filechooser');

    await dropzone.click();

    const fileChooser = await fileChooserPromise;
    expect(fileChooser).toBeTruthy();
  });

  test('should accept files via file input', async ({ page }) => {
    const fileInput = page.getByTestId('dropzone-input');

    // Create a test file and set it on the input
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content')
    });

    // Verify the dropzone is still functional after file selection
    // (without database unlocked, files won't be processed but UI stays stable)
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });

  test('should show dragging state on dragover (unlocked)', async ({
    page
  }) => {
    // First unlock the database
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go back to home
    await page.getByRole('link', { name: 'Tearleads' }).click();

    const dropzone = page.getByTestId('dropzone');

    // Verify initial state
    await expect(dropzone).toHaveAttribute('data-dragging', 'false');

    // Simulate dragover
    await dropzone.dispatchEvent('dragover');

    // Verify dragging state
    await expect(dropzone).toHaveAttribute('data-dragging', 'true');
    await expect(page.getByText('Drop files here')).toBeVisible();
  });

  test('should remove dragging state on dragleave (unlocked)', async ({
    page
  }) => {
    // First unlock the database
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go back to home
    await page.getByRole('link', { name: 'Tearleads' }).click();

    const dropzone = page.getByTestId('dropzone');

    // Set dragging state
    await dropzone.dispatchEvent('dragover');
    await expect(dropzone).toHaveAttribute('data-dragging', 'true');

    // Simulate dragleave
    await dropzone.dispatchEvent('dragleave');

    // Verify dragging state removed
    await expect(dropzone).toHaveAttribute('data-dragging', 'false');
  });

  test('should upload file and show completion status', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go back to home
    await page.getByRole('link', { name: 'Tearleads' }).click();

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

  test('should display formatted file size during upload', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go back to home
    await page.getByRole('link', { name: 'Tearleads' }).click();

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

  test('should upload multiple files', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go back to home
    await page.getByRole('link', { name: 'Tearleads' }).click();

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

  test('should show files in list after upload', async ({ page }) => {
    // First unlock the database
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Go back to home (which is now the Files page)
    await page.getByRole('link', { name: 'Tearleads' }).click();

    const fileInput = page.getByTestId('dropzone-input');

    await fileInput.setInputFiles({
      name: 'uploaded-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content for files page')
    });

    // Wait for upload to complete and verify file appears in the listing
    // The file list auto-refreshes after upload completes
    await expect(page.getByText('uploaded-file.txt', { exact: true })).toBeVisible();
  });
});

test.describe('Debug page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should navigate to debug page when debug link is clicked', async ({
    page
  }) => {
    const debugLink = page.locator('aside nav').getByRole('link', { name: 'Debug' });
    await expect(debugLink).toBeVisible();

    await debugLink.click();

    await expect(page.getByRole('heading', { name: 'Debug' })).toBeVisible();
  });

  test('should display environment info on debug page', async ({ page }) => {
    await navigateTo(page, 'Debug');

    await expect(page.getByText('Environment Info')).toBeVisible();
    await expect(page.getByText(/Environment:/)).toBeVisible();
    await expect(page.getByText(/Screen:/)).toBeVisible();
    await expect(page.getByText(/User Agent:/)).toBeVisible();
  });

  test('should display device info on debug page', async ({ page }) => {
    await navigateTo(page, 'Debug');

    await expect(page.getByText('Device Info')).toBeVisible();
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

  test('should navigate back to home when logo is clicked', async ({
    page
  }) => {
    await navigateTo(page, 'Debug');
    await expect(page.getByRole('heading', { name: 'Debug' })).toBeVisible();

    // Click the logo/title to go back home
    await page.getByRole('link', { name: 'Tearleads' }).click();

    // Should be back on the home page with dropzone visible
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });
});

test.describe('Tables page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should navigate to tables page when tables link is clicked', async ({
    page
  }) => {
    const tablesLink = page.locator('aside nav').getByRole('link', { name: 'Tables' });
    await expect(tablesLink).toBeVisible();

    await tablesLink.click();

    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });

  test('should show locked message when database is not unlocked', async ({
    page
  }) => {
    await navigateTo(page, 'Tables');

    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
    await expect(
      page.getByText('Database is locked. Unlock it from the Debug page')
    ).toBeVisible();
  });

  test('should show tables list when database is unlocked', async ({
    page
  }) => {
    // First unlock the database via Debug page
    await navigateTo(page, 'Debug');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Reset and setup database
    await page.getByTestId('db-reset-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
      timeout: 10000
    });

    await page.getByTestId('db-password-input').fill('testpassword123');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

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

  test('should refresh tables list when refresh button is clicked', async ({
    page
  }) => {
    // Setup database first
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-reset-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
      timeout: 10000
    });
    await page.getByTestId('db-password-input').fill('testpassword123');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

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

  test('should navigate to table rows view and display file data', async ({
    page
  }) => {
    // Setup database first
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-reset-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
      timeout: 10000
    });
    await page.getByTestId('db-password-input').fill('testpassword123');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Navigate to home using client-side navigation (preserves db session)
    await page.getByRole('link', { name: 'Tearleads Tearleads' }).click();
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
    await expect(page.getByText('Back')).toBeVisible();

    // Should show table name in header
    await expect(
      page.getByRole('heading', { name: 'files', exact: true })
    ).toBeVisible();

    // Should show column headers (from files table schema)
    // Note: id column is hidden by default
    await expect(page.getByRole('columnheader', { name: /name/i })).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByRole('columnheader', { name: /size/i })).toBeVisible();

    // Should show row count (confirms data loaded)
    await expect(page.getByText(/Showing 1 row/)).toBeVisible({ timeout: 10000 });

    // Should show our uploaded file data
    await expect(page.getByText('test-file.png', { exact: true })).toBeVisible();

    // Click back to return to tables list
    await page.getByText('Back').click();
    await expect(page).toHaveURL('/tables');
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
  });

  test('should toggle document view to show JSON format', async ({ page }) => {
    // Setup database first
    await navigateTo(page, 'Debug');
    await page.getByTestId('db-reset-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
      timeout: 10000
    });
    await page.getByTestId('db-password-input').fill('testpassword123');
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
      timeout: 10000
    });

    // Navigate to home and upload a file
    await page.getByRole('link', { name: 'Tearleads Tearleads' }).click();
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

    // Initially should show table view with column headers (id hidden by default)
    await expect(page.getByRole('columnheader', { name: /name/i })).toBeVisible();
    await expect(page.locator('pre')).not.toBeVisible();

    // Click the document view toggle button (Braces icon)
    await page.getByRole('button', { name: 'Toggle document view' }).click();

    // Should now show JSON document format in pre tags (wait for render)
    const preElement = page.locator('pre').first();
    await expect(preElement).toBeVisible({ timeout: 10000 });

    // Should contain the file name in JSON format
    await expect(preElement).toContainText('"name": "doc-view-test.png"');

    // Table headers should not be visible in document view
    await expect(
      page.getByRole('columnheader', { name: /name/i })
    ).not.toBeVisible();

    // Toggle back to table view
    await page.getByRole('button', { name: 'Toggle document view' }).click();

    // Should show table view again
    await expect(page.getByRole('columnheader', { name: /name/i })).toBeVisible();
    await expect(page.locator('pre')).not.toBeVisible();
  });
});

test.describe('Models page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should navigate to models page when models link is clicked', async ({
    page
  }) => {
    const modelsLink = page.locator('aside nav').getByRole('link', { name: 'Models' });
    await expect(modelsLink).toBeVisible();

    await modelsLink.click();

    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  });

  test('should display model cards or WebGPU not supported message', async ({ page }) => {
    await navigateTo(page, 'Models');

    // Wait for page to load - either model cards or WebGPU error
    await expect(
      page.getByText('Llama 3.2 1B Instruct').or(page.getByText('WebGPU Not Supported'))
    ).toBeVisible({ timeout: 10000 });

    // If WebGPU is supported, verify model cards are shown
    const webGPUNotSupported = await page.getByText('WebGPU Not Supported').isVisible();
    if (!webGPUNotSupported) {
      await expect(page.getByText('Llama 3.2 1B Instruct')).toBeVisible();
      await expect(page.getByText('Llama 3.2 3B Instruct')).toBeVisible();
      await expect(page.getByText('Phi 3.5 Mini')).toBeVisible();
    }
  });

  test('should show model sizes or WebGPU not supported message', async ({ page }) => {
    await navigateTo(page, 'Models');

    // Wait for page to load
    await expect(
      page.getByText(/~700MB/).or(page.getByText('WebGPU Not Supported'))
    ).toBeVisible({ timeout: 10000 });

    // If WebGPU is supported, verify sizes are shown
    const webGPUNotSupported = await page.getByText('WebGPU Not Supported').isVisible();
    if (!webGPUNotSupported) {
      await expect(page.getByText(/~700MB/)).toBeVisible();
      await expect(page.getByText(/~1\.8GB/)).toBeVisible();
    }
  });

  test('should show description text or WebGPU not supported message', async ({ page }) => {
    await navigateTo(page, 'Models');

    // Wait for page to load
    await expect(
      page.getByText(/Download and run LLMs locally/).or(page.getByText('WebGPU Not Supported'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show download buttons for models not cached when WebGPU is supported', async ({
    page
  }) => {
    await navigateTo(page, 'Models');

    // Wait for page to load
    await expect(
      page.getByText('Llama 3.2 1B Instruct').or(page.getByText('WebGPU Not Supported'))
    ).toBeVisible({ timeout: 10000 });

    // Skip rest of test if WebGPU not supported
    const webGPUNotSupported = await page.getByText('WebGPU Not Supported').isVisible();
    if (webGPUNotSupported) {
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

    // Wait for page to load
    await expect(
      page.getByText('Llama 3.2 1B Instruct').or(page.getByText('WebGPU Not Supported'))
    ).toBeVisible({ timeout: 10000 });

    // Skip rest of test if WebGPU not supported
    const webGPUNotSupported = await page.getByText('WebGPU Not Supported').isVisible();
    if (webGPUNotSupported) {
      return;
    }

    // Get the initial state of buttons (should be Download since not cached)
    const initialDownloadButtons = await page.getByRole('button', { name: /Download/i }).count();

    // Reload the page
    await page.reload();

    // Wait for models page to load again
    await expect(page.getByText('Llama 3.2 1B Instruct')).toBeVisible({
      timeout: 10000
    });

    // Count buttons again - should be the same since no model was actually downloaded
    const afterReloadDownloadButtons = await page.getByRole('button', { name: /Download/i }).count();

    // The button count should be consistent (cache detection is working)
    expect(afterReloadDownloadButtons).toBe(initialDownloadButtons);
  });

  test('should show appropriate WebGPU status', async ({ page }) => {
    await navigateTo(page, 'Models');

    // Page should show either model cards (WebGPU supported) or error message (not supported)
    await expect(
      page.getByText('Llama 3.2 1B Instruct').or(page.getByText('WebGPU Not Supported'))
    ).toBeVisible({ timeout: 10000 });

    // Verify the two states are mutually exclusive
    const hasModelCards = await page.getByText('Llama 3.2 1B Instruct').isVisible();
    const hasWebGPUError = await page.getByText('WebGPU Not Supported').isVisible();

    // Exactly one should be true
    expect(hasModelCards !== hasWebGPUError).toBe(true);
  });
});
