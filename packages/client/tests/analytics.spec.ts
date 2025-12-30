import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to navigate via sidebar
async function navigateTo(page: Page, linkName: string) {
  const link = page.locator('aside nav').getByRole('link', { name: linkName });
  await link.click();
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
    /Each child in a list should have a unique "key" prop/i
  ];
  return !ignoredPatterns.some((pattern) => pattern.test(text));
}

test.describe('Analytics page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should navigate to analytics page', async ({ page }) => {
    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  });

  test('should show locked message when database is not unlocked', async ({
    page
  }) => {
    await navigateTo(page, 'Analytics');

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(
      page.getByText(
        'Database is locked. Unlock it from the SQLite page to view analytics.'
      )
    ).toBeVisible();
  });

  test('should display analytics UI when database is unlocked', async ({
    page
  }) => {
    await setupDatabase(page);
    await navigateTo(page, 'Analytics');

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for data to load (events table or empty state)
    await expect(
      page
        .getByText('No events recorded yet')
        .or(page.getByText('Recent Events'))
    ).toBeVisible({ timeout: 10000 });

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
  test('should not have console errors on analytics page load', async ({
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
      .or(page.getByText('Recent Events'))
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
  test('should not have undefined property errors in formatEventName', async ({
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

  test('should display events after database operations generate them', async ({
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
        .or(page.getByText('Recent Events'))
    ).toBeVisible({ timeout: 10000 });

    // Should show Recent Events section (db operations should have generated events)
    await expect(page.getByText('Recent Events')).toBeVisible({ timeout: 5000 });
  });

  test('should change time filter without errors', async ({ page }) => {
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
        .or(page.getByText('Recent Events'))
    ).toBeVisible({ timeout: 10000 });

    // Helper to click a time filter and wait for loading to complete
    const clickTimeFilter = async (name: string) => {
      await page.getByRole('button', { name }).click();
      // Wait for loading spinner to appear and disappear
      const spinner = page.locator('svg.animate-spin');
      await expect(spinner).toBeVisible({ timeout: 5000 }).catch(() => {
        // Spinner may be too fast to catch, which is fine
      });
      await expect(spinner).not.toBeVisible({ timeout: 10000 });
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

  test('should refresh data without flickering or errors', async ({ page }) => {
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
    await expect(page.getByText('Recent Events')).toBeVisible({ timeout: 10000 });

    // Click refresh multiple times rapidly to test stability
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    const spinner = page.locator('svg.animate-spin');

    await refreshButton.click();
    await refreshButton.click();
    await refreshButton.click();

    // Wait for loading to complete (spinner disappears)
    await expect(spinner).not.toBeVisible({ timeout: 10000 });

    expect(
      consoleErrors,
      `Found console errors:\n${consoleErrors.join('\n')}`
    ).toEqual([]);
  });

  test('should clear events and show empty state', async ({ page }) => {
    await setupDatabase(page);

    // Generate some analytics events
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for events to load
    await expect(page.getByText('Recent Events')).toBeVisible({ timeout: 10000 });

    // Clear events
    const clearButton = page.getByRole('button', { name: 'Clear' });
    await expect(clearButton).toBeEnabled({ timeout: 5000 });
    await clearButton.click();

    // Should show empty state
    await expect(page.getByText('No events recorded yet')).toBeVisible({
      timeout: 5000
    });
  });

  test('should handle rapid navigation without errors', async ({ page }) => {
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

  test('should display formatted event names correctly', async ({ page }) => {
    await setupDatabase(page);

    // Generate analytics events by performing database operations
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for events to load
    await expect(page.getByText('Recent Events')).toBeVisible({ timeout: 10000 });

    // The event names should be formatted (e.g., "db_write" -> "Write")
    // At least one formatted event name should be visible
    const eventTable = page.locator('table');
    await expect(eventTable).toBeVisible({ timeout: 5000 });

    // Verify table has rows (headers + at least one data row)
    const rows = eventTable.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Regression test to verify analytics data values are displayed correctly.
   * Checks that event names, durations, and statuses are not showing
   * undefined, NaN, or other invalid values.
   */
  test('should display valid data values (not NaN, undefined, or Invalid Date)', async ({
    page
  }) => {
    await setupDatabase(page);

    // Generate analytics events
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    await navigateTo(page, 'Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    // Wait for events table to load
    await expect(page.getByText('Recent Events')).toBeVisible({ timeout: 10000 });
    const eventTable = page.locator('table');
    await expect(eventTable).toBeVisible({ timeout: 5000 });

    // Wait for at least one data row
    const firstRow = eventTable.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });

    // Get all table cells in the first row
    const cells = firstRow.locator('td');
    const cellCount = await cells.count();

    // Verify each cell does not contain invalid values
    for (let i = 0; i < cellCount; i++) {
      const cell = cells.nth(i);
      const text = await cell.textContent();

      // Cell should not be empty or contain invalid values
      expect(text, `Cell ${i} should not be undefined`).not.toContain('undefined');
      expect(text, `Cell ${i} should not be NaN`).not.toBe('NaN');
      expect(text, `Cell ${i} should not be Invalid Date`).not.toContain(
        'Invalid Date'
      );
      // Event name cell should not be "(Unknown)" if we successfully recorded events
      if (i === 0) {
        expect(text, 'Event name should not be (Unknown)').not.toBe('(Unknown)');
      }
    }

    // Verify at least one "Success" status exists (db_write should succeed)
    await expect(eventTable.getByText('Success').first()).toBeVisible({
      timeout: 5000
    });
  });
});
