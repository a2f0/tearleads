import { test, expect, Page } from '@playwright/test';

const IGNORED_WARNING_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /apple-mobile-web-app-capable.*deprecated/i
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
    const settingsLink = page.getByTestId('settings-link');
    await expect(settingsLink).toBeVisible();

    await settingsLink.click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('should toggle dark mode from settings', async ({ page }) => {
    // Navigate to settings
    await page.getByTestId('settings-link').click();
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
    await page.getByTestId('settings-link').click();

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

  test('should open file picker when dropzone is clicked', async ({ page }) => {
    const dropzone = page.getByTestId('dropzone');

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
    // (the current implementation logs to console, so we verify the UI remains stable)
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });

  test('should show dragging state on dragover', async ({ page }) => {
    const dropzone = page.getByTestId('dropzone');

    // Verify initial state
    await expect(dropzone).toHaveAttribute('data-dragging', 'false');

    // Simulate dragover
    await dropzone.dispatchEvent('dragover');

    // Verify dragging state
    await expect(dropzone).toHaveAttribute('data-dragging', 'true');
    await expect(page.getByText('Drop files here')).toBeVisible();
  });

  test('should remove dragging state on dragleave', async ({ page }) => {
    const dropzone = page.getByTestId('dropzone');

    // Set dragging state
    await dropzone.dispatchEvent('dragover');
    await expect(dropzone).toHaveAttribute('data-dragging', 'true');

    // Simulate dragleave
    await dropzone.dispatchEvent('dragleave');

    // Verify dragging state removed
    await expect(dropzone).toHaveAttribute('data-dragging', 'false');
  });
});

test.describe('Debug page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should navigate to debug page when debug link is clicked', async ({
    page
  }) => {
    const debugLink = page.getByTestId('debug-link');
    await expect(debugLink).toBeVisible();

    await debugLink.click();

    await expect(page.getByRole('heading', { name: 'Debug' })).toBeVisible();
  });

  test('should display environment info on debug page', async ({ page }) => {
    await page.getByTestId('debug-link').click();

    await expect(page.getByText('Environment Info')).toBeVisible();
    await expect(page.getByText(/Environment:/)).toBeVisible();
    await expect(page.getByText(/Screen:/)).toBeVisible();
    await expect(page.getByText(/User Agent:/)).toBeVisible();
  });

  test('should fetch and display API health status', async ({ page }) => {
    await page.getByTestId('debug-link').click();

    // Wait for health data to load (either success or error)
    const healthStatus = page.getByText(/Healthy|Failed to connect to API/);
    await expect(healthStatus).toBeVisible({ timeout: 10000 });
  });

  test('should refresh health data when refresh button is clicked', async ({
    page
  }) => {
    await page.getByTestId('debug-link').click();

    // Wait for initial load to complete (button becomes enabled)
    const refreshButton = page.getByRole('button', { name: /^Refresh$/ });
    await expect(refreshButton).toBeEnabled({ timeout: 10000 });

    await refreshButton.click();

    // Should show refreshing state or remain showing data
    await expect(
      page.getByRole('button', { name: /Refresh|Refreshing/ })
    ).toBeVisible();
  });

  test('should navigate back to home when back button is clicked', async ({
    page
  }) => {
    await page.getByTestId('debug-link').click();
    await expect(page.getByRole('heading', { name: 'Debug' })).toBeVisible();

    // Click the back button
    const backButton = page.getByRole('link', { name: 'Go back' });
    await backButton.click();

    // Should be back on the home page
    await expect(
      page.getByRole('heading', { name: 'Tearleads', level: 1 })
    ).toBeVisible();
  });
});
