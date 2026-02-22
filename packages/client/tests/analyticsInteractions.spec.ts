import type { Page } from '@playwright/test';
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


test.describe('Analytics page interactions', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  dbTest('should handle tearleads navigation without errors', async ({ page }) => {
    const pageErrors: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await setupDatabase(page);

    // Tearleadsly navigate between pages
    for (let i = 0; i < 3; i++) {
      await navigateTo(page, 'Analytics');
      await unlockIfNeeded(page);
      await expect(
        page.getByRole('heading', { name: 'Analytics' })
      ).toBeVisible();

      await navigateTo(page, 'SQLite');
      await unlockIfNeeded(page);
      await expect(page.getByTestId('database-test')).toBeVisible();
    }

    // End on Analytics page
    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);
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
    await unlockIfNeeded(page);
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
    await unlockIfNeeded(page);
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
    await unlockIfNeeded(page);
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
  /**
   * Test for sticky scroll behavior on the analytics page.
   * The duration chart, status line, and table header should remain visible
   * when scrolling down through the events list.
   */
  dbTest('should keep chart, status line, and table header sticky when scrolling', async ({
    page
  }) => {
    // Use a smaller viewport to ensure content is scrollable
    await page.setViewportSize({ width: 1280, height: 600 });

    await setupDatabase(page);

    // Generate multiple analytics events to ensure we have scrollable content
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('db-write-button').click();
      await waitForSuccess(page);
      await page.getByTestId('db-read-button').click();
      await waitForSuccess(page);
    }

    await navigateTo(page, 'Analytics');
    await unlockIfNeeded(page);
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for chart and events to load
    await expect(page.getByText('Duration Over Time')).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });
    await expect(page.getByTestId('analytics-header')).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Find the Analytics events scroll container by data-testid
    const scrollContainer = page.getByTestId('analytics-events-scroll-container');
    await expect(scrollContainer).toBeVisible();

    // Get the initial positions of sticky elements
    const chartTitle = page.getByText('Duration Over Time');
    const tableHeader = page.getByTestId('analytics-header');

    // Verify elements are visible before scrolling
    await expect(chartTitle).toBeVisible();
    await expect(tableHeader).toBeVisible();

    // Get initial bounding box
    const chartBoundingBoxBefore = await chartTitle.boundingBox();
    expect(chartBoundingBoxBefore).not.toBeNull();

    // Check if the scroll container is actually scrollable
    const scrollInfo = await scrollContainer.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      isScrollable: el.scrollHeight > el.clientHeight
    }));

    // The scroll container should be scrollable with enough content and small viewport
    expect(
      scrollInfo.isScrollable,
      `Scroll container should be scrollable (scrollHeight: ${scrollInfo.scrollHeight}, clientHeight: ${scrollInfo.clientHeight})`
    ).toBe(true);

    // Get position of sticky element relative to scroll container
    const stickyOffsetTop = await page.evaluate(() => {
      const scrollContainer = document.querySelector('[data-testid="analytics-events-scroll-container"]');
      const stickyEl = document.querySelector('.sticky.top-0');
      if (!scrollContainer || !stickyEl) return 0;
      return (stickyEl as HTMLElement).offsetTop;
    });

    // Scroll past the sticky element's initial position to trigger sticky
    const scrollAmount = stickyOffsetTop + 100;
    await scrollContainer.evaluate((el, amount) => {
      el.scrollTop = amount;
    }, scrollAmount);

    // Wait for next animation frame to ensure scroll completes
    await page.evaluate(() => new Promise(requestAnimationFrame));

    // Check scroll position after
    const scrollTopAfter = await scrollContainer.evaluate((el) => el.scrollTop);

    // Verify we actually scrolled
    expect(scrollTopAfter, 'Should have scrolled down').toBeGreaterThan(0);

    // Verify sticky elements are still visible after scrolling
    await expect(chartTitle).toBeVisible();
    await expect(tableHeader).toBeVisible();

    // Get bounding boxes after scrolling
    const chartBoundingBoxAfter = await chartTitle.boundingBox();
    const headerBoundingBoxAfter = await tableHeader.boundingBox();

    expect(chartBoundingBoxAfter).not.toBeNull();
    expect(headerBoundingBoxAfter).not.toBeNull();

    const chartYBefore = chartBoundingBoxBefore?.y ?? 0;
    const chartYAfter = chartBoundingBoxAfter?.y ?? 0;
    const headerYAfter = headerBoundingBoxAfter?.y ?? 0;

    // If sticky is working, the chart should still be visible near the top after scrolling.
    // Without sticky, the chart would have scrolled off the top of the viewport.
    // Example: chart starts at Y=452, we scroll 457px, so without sticky it would be at Y=-5
    // With sticky, it stays visible (Y > 0) near the top (Y < 200)
    expect(
      chartYAfter,
      `Chart should be visible (sticky) after scroll - started at Y=${chartYBefore}, scrolled ${scrollTopAfter}px, now at Y=${chartYAfter} (would be ~${chartYBefore - scrollTopAfter} if not sticky)`
    ).toBeGreaterThan(0);

    expect(
      chartYAfter,
      `Chart should be near top of viewport after scroll - Y position: ${chartYAfter}px`
    ).toBeLessThan(250);

    // The table header is part of the sticky section, so it should also be visible
    expect(
      headerYAfter,
      `Table header should be visible after scroll - Y position: ${headerYAfter}px`
    ).toBeGreaterThan(0);
  });

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
