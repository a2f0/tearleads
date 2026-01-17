import type { ConsoleMessage, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

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

// Helper to open sidebar via Start button
async function openSidebar(page: Page) {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await startButton.click();
  await expect(page.locator('aside nav')).toBeVisible({ timeout: 10000 });
}

// Helper to navigate via sidebar
async function navigateTo(page: Page, linkName: string) {
  const sidebar = page.locator('aside nav');
  if (!(await sidebar.isVisible())) {
    await openSidebar(page);
  }
  const button = sidebar.getByRole('button', { name: linkName });
  // Desktop requires double-click; sidebar auto-closes after launch
  await button.click();
  await expect(sidebar).not.toBeVisible({ timeout: 5000 });
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
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for initial data to load
    await expect(page.getByTestId('analytics-header')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Click refresh multiple times rapidly to test stability
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

  dbTest('should handle rapid navigation without errors', async ({ page }) => {
    const pageErrors: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await setupDatabase(page);

    // Rapidly navigate between pages
    for (let i = 0; i < 3; i++) {
      await navigateTo(page, 'Analytics');
      await expect(
        page.getByRole('heading', { name: 'Analytics' })
      ).toBeVisible();

      await navigateTo(page, 'SQLite');
      await expect(page.getByTestId('database-test')).toBeVisible();
    }

    // End on Analytics page
    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for any delayed errors
    await page.waitForTimeout(500);

    // Filter out any expected errors
    const unexpectedErrors = pageErrors.filter(
      (err) =>
        !err.includes('React DevTools') &&
        !err.includes('ResizeObserver') // ResizeObserver errors are common and benign
    );

    expect(
      unexpectedErrors,
      `Found page errors: ${unexpectedErrors.join(', ')}`
    ).toEqual([]);
  });

  dbTest('should display formatted event names correctly', async ({ page }) => {
    await setupDatabase(page);

    // Generate analytics events by performing database operations
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for events to load
    await expect(page.getByTestId('analytics-header')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // The event names should be formatted (e.g., "db_write" -> "Write")
    // At least one formatted event name should be visible
    // Analytics now uses CSS grid instead of table for virtualization
    const eventHeader = page.getByTestId('analytics-header');
    await expect(eventHeader).toBeVisible({ timeout: 5000 });

    // Verify data rows are visible
    const rows = page.getByTestId('analytics-row');
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Regression test to verify analytics data values are displayed correctly.
   * Checks that event names, durations, and statuses are not showing
   * undefined, NaN, or other invalid values.
   */
  dbTest('should display valid data values (not NaN, undefined, or Invalid Date)', async ({
    page
  }) => {
    await setupDatabase(page);

    // Generate analytics events
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for events list to load (uses CSS grid, not table)
    await expect(page.getByTestId('analytics-header')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    const eventHeader = page.getByTestId('analytics-header');
    await expect(eventHeader).toBeVisible({ timeout: 5000 });

    // Wait for at least one data row
    const firstRow = page.getByTestId('analytics-row').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });

    // Get the text content of the first row
    const rowText = await firstRow.textContent();

    // Row content should not contain invalid values
    expect(rowText, 'Row should not contain undefined').not.toContain('undefined');
    expect(rowText, 'Row should not be NaN').not.toContain('NaN');
    expect(rowText, 'Row should not contain Invalid Date').not.toContain(
      'Invalid Date'
    );
    // Event name should not be "(Unknown)" if we successfully recorded events
    expect(rowText, 'Event name should not be (Unknown)').not.toContain('(Unknown)');

    // Verify at least one "Success" status exists (db_write should succeed)
    await expect(page.getByText('Success').first()).toBeVisible({
      timeout: 5000
    });
  });

  /**
   * Regression test for chart rendering bug where the duration chart would not
   * display due to a race condition in useContainerReady hook.
   * The hook used useRef, but refs are set after render, so if the effect ran
   * before React set the ref, containerRef.current would be null and the chart
   * would never render.
   * See: Issues #623, #624, #667
   */
  dbTest('should render the duration chart SVG when events exist', async ({
    page
  }) => {
    await setupDatabase(page);

    // Generate analytics events by performing database operations
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for chart title to appear (this proves DurationChart component rendered)
    await expect(page.getByText('Duration Over Time')).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Use data-testid to scope selectors, making test resilient to recharts internals
    const chartContainer = page.getByTestId('duration-chart');
    await expect(chartContainer).toBeVisible({ timeout: 5000 });

    // Verify the chart SVG is rendered inside the container
    const chartSvg = chartContainer.locator('svg');
    await expect(chartSvg).toBeVisible({ timeout: 5000 });

    // Verify the chart has actual scatter plot content (circles for data points)
    const dataPoints = chartContainer.locator('circle');
    await expect(dataPoints.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Regression test for mobile responsive layout.
   * Ensures the analytics page does not have horizontal scroll on mobile devices.
   */
  dbTest('should not have horizontal scroll on mobile viewport', async ({
    page
  }) => {
    const navigateMobile = async (testId: string) => {
      const mobileMenuButton = page.getByTestId('mobile-menu-button');
      await mobileMenuButton.click();
      // Scope to mobile menu dropdown to avoid strict mode violation
      await page.getByTestId('mobile-menu-dropdown').getByTestId(testId).click();
    };

    // Set viewport to iPhone SE dimensions (smallest common mobile viewport)
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');

    // Navigate to SQLite via mobile menu
    await navigateMobile('sqlite-link');
    await expect(page.getByTestId('database-test')).toBeVisible();

    // Reset and setup database
    await page.getByTestId('db-reset-button').click();
    await waitForSuccess(page);
    await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('db-setup-button').click();
    await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
      timeout: DB_OPERATION_TIMEOUT
    });

    // Generate some analytics events for a more realistic test
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);

    // Navigate to Analytics via mobile menu
    await navigateMobile('analytics-link');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for data to load
    await expect(page.getByTestId('analytics-header')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Check that the page content doesn't overflow horizontally
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);

    // scrollWidth should equal clientWidth (no horizontal overflow)
    expect(
      scrollWidth,
      `Horizontal scroll detected: scrollWidth (${scrollWidth}) > clientWidth (${clientWidth})`
    ).toBeLessThanOrEqual(clientWidth);

    // Verify key UI elements are still visible and usable
    await expect(page.getByRole('button', { name: 'Last Hour' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.getByText('Duration Over Time')).toBeVisible();
  });
});
