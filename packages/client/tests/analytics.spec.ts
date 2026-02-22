import type { ConsoleMessage, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './testUtils';

// Use dbTest for tests that require database setup
const dbTest = test;

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;
const PAGE_LOAD_TIMEOUT = 5000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Map page names to routes
const PAGE_ROUTES: Record<string, string> = {
  Analytics: '/analytics',
  SQLite: '/sqlite'
};

// Helper to navigate via URL (for testing page behavior)
async function navigateTo(page: Page, pageName: string) {
  const route = PAGE_ROUTES[pageName];
  if (!route) {
    throw new Error(`Unknown page: ${pageName}`);
  }
  await page.goto(route);
}

// Helper to unlock via inline unlock component if database is locked after page navigation
async function unlockIfNeeded(page: Page) {
  // Wait a moment for the page to stabilize after navigation
  await page.waitForTimeout(500);

  const inlineUnlock = page.getByTestId('inline-unlock-password');
  if (await inlineUnlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inlineUnlock.fill(TEST_PASSWORD);
    await page.getByTestId('inline-unlock-button').click();
    // Wait for the unlock to complete and content to load
    await expect(inlineUnlock).not.toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
  }
}

// Helper to setup database
async function setupDatabase(page: Page) {
  await navigateTo(page, 'SQLite');
  await expect(page.getByTestId('database-test')).toBeVisible();

  // Reset to ensure clean state
  await page.getByTestId('db-reset-button').click();
  await waitForSuccess(page);
  await expect(page.getByTestId('db-status')).toHaveText('Not Set Up');

  // Setup with password
  await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
}

// Filter out known/expected console messages
function isUnexpectedError(text: string): boolean {
  const ignoredPatterns = [
    /React DevTools/i,
    /Download the React DevTools/i,
    // React development warnings (not actual errors)
    /Each child in a list should have a unique "key" prop/i,
    // Network errors are expected when API server isn't running (PWA works offline)
    /ERR_CONNECTION_REFUSED/i,
    /Failed to load resource/i
  ];
  return !ignoredPatterns.some((pattern) => pattern.test(text));
}

test.describe('Analytics page', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should navigate to analytics page', async ({ page }) => {
    await navigateTo(page, 'Analytics');
    const heading = page.getByRole('heading', { name: 'Analytics' });
    await expect(heading).toBeVisible();
  });

  test('should show inline unlock when database is not unlocked', async ({
    page
  }) => {
    await navigateTo(page, 'Analytics');

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      page.getByText(/Database is (locked|not set up)/)
    ).toBeVisible();
  });

  dbTest('should display analytics UI when database is unlocked', async ({
    page
  }) => {
    await setupDatabase(page);
    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for data to load (events table or empty state)
    await expect(
      page
        .getByText('No events recorded yet')
        .or(page.getByText(/^Viewing \d+-\d+ of \d+ events?$/))
    ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Time filter buttons should be visible
    await expect(page.getByRole('button', { name: 'Last Hour' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Last 24h' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Last Week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Time' })).toBeVisible();

    // Refresh and Clear buttons should be visible
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  /**
   * Regression test for analytics page flickering and "cannot read properties
   * of undefined (reading 'replace')" error in formatEventName function.
   * See: PR #196, PR #199
   *
   * This test captures console errors during analytics page load. The page
   * should render without any JavaScript errors.
   */
  dbTest('should not have console errors on analytics page load', async ({
    page
  }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && isUnexpectedError(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      if (isUnexpectedError(error.message)) {
        consoleErrors.push(error.message);
      }
    });

    await setupDatabase(page);
    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);

    // Wait for page to attempt to load - either successfully or with error boundary
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for loading to settle - the page may crash, show error boundary,
    // or successfully render. Give it time to stabilize.
    await page.waitForTimeout(2000);

    // Check if the page rendered successfully (either with events or empty state)
    // or if it crashed and is showing an error boundary
    const hasContent = await page
      .getByText('No events recorded yet')
      .or(page.getByText(/^Viewing \d+-\d+ of \d+ events?$/))
      .or(page.getByText('Loading events...'))
      .isVisible()
      .catch(() => false);

    // If content loaded successfully, verify no errors were caught
    // If content didn't load, the errors array should tell us why
    expect(
      consoleErrors,
      `Found console errors:\n${consoleErrors.join('\n')}`
    ).toEqual([]);

    // Also verify the page actually loaded (wasn't completely broken)
    expect(hasContent).toBe(true);
  });

  /**
   * Specific regression test for the "cannot read properties of undefined
   * (reading 'replace')" error that occurs when formatEventName receives
   * undefined eventName values from analytics data.
   *
   * This is the exact error: TypeError: Cannot read properties of undefined (reading 'replace')
   * Location: formatEventName in Analytics.tsx
   */
  dbTest('should not have undefined property errors in formatEventName', async ({
    page
  }) => {
    const undefinedErrors: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (
        msg.type() === 'error' &&
        text.toLowerCase().includes('cannot read properties of undefined')
      ) {
        undefinedErrors.push(text);
      }
    });

    page.on('pageerror', (error) => {
      if (
        error.message.toLowerCase().includes('cannot read properties of undefined')
      ) {
        undefinedErrors.push(error.message);
      }
    });

    await setupDatabase(page);
    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);

    // Wait for analytics page header
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for page to settle - errors typically occur during initial render
    await page.waitForTimeout(2000);

    expect(
      undefinedErrors,
      `Found "undefined" errors:\n${undefinedErrors.join('\n')}`
    ).toEqual([]);
  });

  dbTest('should display events after database operations generate them', async ({
    page
  }) => {
    await setupDatabase(page);

    // Perform a write operation to generate analytics event
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    // Navigate to analytics
    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for data to load
    await expect(
      page
        .getByText('No events recorded yet')
        .or(page.getByText(/^Viewing \d+-\d+ of \d+ events?$/))
    ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Should show events section (db operations should have generated events)
    await expect(page.getByTestId('analytics-header')).toBeVisible({ timeout: 5000 });
  });

  dbTest('should change time filter without errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && isUnexpectedError(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      if (isUnexpectedError(error.message)) {
        consoleErrors.push(error.message);
      }
    });

    await setupDatabase(page);
    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);

    // Wait for page to load and data to be ready
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(
      page
        .getByText('No events recorded yet')
        .or(page.getByText(/^Viewing \d+-\d+ of \d+ events?$/))
    ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Helper to click a time filter and wait for UI to settle
    const clickTimeFilter = async (name: string) => {
      await page.getByRole('button', { name }).click();
      // Wait briefly for the filter to apply (can't use networkidle due to SSE connection)
      await page.waitForTimeout(500);
    };

    // Click through different time filters
    await clickTimeFilter('Last Hour');
    await clickTimeFilter('Last Week');
    await clickTimeFilter('All Time');
    await clickTimeFilter('Last 24h');

    expect(
      consoleErrors,
      `Found console errors:\n${consoleErrors.join('\n')}`
    ).toEqual([]);
  });

  dbTest('should refresh data without flickering or errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && isUnexpectedError(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      if (isUnexpectedError(error.message)) {
        consoleErrors.push(error.message);
      }
    });

    await setupDatabase(page);

    // Generate some analytics events
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for initial data to load
    await expect
      .poll(
        async () => {
          if (await page.getByTestId('analytics-header').isVisible()) {
            return 'header';
          }
          if (await page.getByText('No events recorded yet').isVisible()) {
            return 'empty';
          }
          if (
            await page
              .getByText(/^Viewing \d+-\d+ of \d+ events?$/)
              .isVisible()
          ) {
            return 'count';
          }
          return '';
        },
        { timeout: PAGE_LOAD_TIMEOUT }
      )
      .toMatch(/header|empty|count/);

    // Click refresh multiple times tearleadsly to test stability
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    const spinner = page.locator('svg.animate-spin');

    await refreshButton.click();
    await refreshButton.click();
    await refreshButton.click();

    // Wait for loading to complete (spinner disappears)
    await expect(spinner).not.toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    expect(
      consoleErrors,
      `Found console errors:\n${consoleErrors.join('\n')}`
    ).toEqual([]);
  });

  dbTest('should clear events and show empty state', async ({ page }) => {
    await setupDatabase(page);

    // Generate some analytics events
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for events to load
    await expect(page.getByTestId('analytics-header')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Clear events
    const clearButton = page.getByRole('button', { name: 'Clear events' });
    await expect(clearButton).toBeEnabled({ timeout: 5000 });
    await clearButton.click();

    // Should show empty state
    await expect(page.getByText('No events recorded yet')).toBeVisible({
      timeout: 5000
    });
  });

});
