import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;
const PAGE_LOAD_TIMEOUT = 15000;

// Helper to wait for successful database operation
const waitForSuccess = (page: Page) =>
  expect(page.getByTestId('db-test-result')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: DB_OPERATION_TIMEOUT }
  );

// Helper to setup database via SQLite page
async function setupDatabase(page: Page) {
  await page.goto('/sqlite');
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

// Helper to unlock via inline unlock component if database is locked
async function unlockIfNeeded(page: Page) {
  // Wait for page to stabilize before checking unlock state
  await page.waitForTimeout(1000);

  const inlineUnlock = page.getByTestId('inline-unlock-password');
  if (await inlineUnlock.isVisible({ timeout: 5000 }).catch(() => false)) {
    await inlineUnlock.fill(TEST_PASSWORD);
    await page.getByTestId('inline-unlock-button').click();
    await expect(inlineUnlock).not.toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
  }
}

test.describe('Table Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    // Set desktop viewport to enable floating windows
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('should navigate to tables list and view table rows', async ({ page }) => {
    await setupDatabase(page);

    // Navigate to tables list
    await page.goto('/sqlite/tables');
    await page.waitForLoadState('networkidle');
    await page.waitForLoadState('domcontentloaded');

    // Wait for app container to be visible (ensures React app has mounted)
    await expect(page.getByTestId('app-container')).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    await unlockIfNeeded(page);

    // Wait for tables list to load - page title is "Tables"
    // Use a longer timeout as the Tables component is lazy-loaded
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Should see at least one table (user_settings is created by default)
    await expect(page.getByRole('link', { name: /user_settings/i })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Click on the table to view rows
    await page.getByRole('link', { name: /user_settings/i }).click();

    // Should see table rows view
    // The table heading should be visible indicating we're on the table view
    await expect(page.getByRole('heading', { name: 'user_settings' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // The scroll container should always be visible (contains either data or "No rows" message)
    await expect(page.getByTestId('scroll-container')).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });
  });

  test('should have scrollable table rows in route view', async ({ page }) => {
    await setupDatabase(page);

    // Generate some analytics events by performing database operations
    // This populates the analytics_events table
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);
    await page.getByTestId('db-read-button').click();
    await waitForSuccess(page);

    // Navigate to analytics_events table which should have data
    await page.goto('/sqlite/tables/analytics_events');
    await page.waitForLoadState('networkidle');
    await unlockIfNeeded(page);

    // Wait for table to load - should show scroll container since we have data
    await expect(page.getByTestId('scroll-container')).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Verify the scroll container has actual height (not collapsed)
    const scrollContainer = page.getByTestId('scroll-container');
    const boundingBox = await scrollContainer.boundingBox();

    expect(boundingBox, 'Scroll container should have dimensions').not.toBeNull();
    expect(
      boundingBox!.height,
      'Scroll container should have meaningful height (not collapsed)'
    ).toBeGreaterThan(100);
  });

  test('should display virtual list status with row count', async ({ page }) => {
    await setupDatabase(page);

    // Generate some data first
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    // Navigate to analytics_events table which has data
    await page.goto('/sqlite/tables/analytics_events');
    await page.waitForLoadState('networkidle');
    await unlockIfNeeded(page);

    // Wait for table heading
    await expect(page.getByRole('heading', { name: 'analytics_events' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Should show row count in virtual list status
    // Pattern: "Viewing X-Y of Z rows" or "X rows"
    await expect(
      page.getByText(/Viewing \d+-\d+ of \d+ rows?/)
        .or(page.getByText(/^\d+ rows?$/))
    ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('should access table from sqlite page table list', async ({ page }) => {
    await setupDatabase(page);

    // The SQLite page shows a list of tables with links
    // Verify we can see and click on a table from that list
    await expect(page.getByTestId('database-test')).toBeVisible({ timeout: 5000 });

    // Wait for table sizes section to load and show table links
    // Tables are shown as links in the TableSizes component
    const tableLink = page.getByRole('link', { name: /user_settings/i });
    await expect(tableLink).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Click on the table link
    await tableLink.click();

    // Should navigate to table rows view
    await expect(page.getByRole('heading', { name: 'user_settings' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });
  });

  test('should have working scroll when viewing table with data', async ({ page }) => {
    await setupDatabase(page);

    // Generate some data first
    await page.getByTestId('db-write-button').click();
    await waitForSuccess(page);

    // Navigate directly to tables list
    await page.goto('/sqlite/tables');
    await page.waitForLoadState('networkidle');
    await page.waitForLoadState('domcontentloaded');

    // Wait for app container to be visible (ensures React app has mounted)
    await expect(page.getByTestId('app-container')).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    await unlockIfNeeded(page);

    // Wait for tables list - page title is "Tables"
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Click on analytics_events table which has data
    const tableLink = page.getByRole('link', { name: /analytics_events/i });
    await expect(tableLink).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await tableLink.click();

    // Verify scroll container exists and has height
    const scrollContainer = page.getByTestId('scroll-container');
    await expect(scrollContainer).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const boundingBox = await scrollContainer.boundingBox();
    expect(boundingBox, 'Scroll container should have dimensions').not.toBeNull();
    expect(
      boundingBox!.height,
      'Scroll container should have meaningful height'
    ).toBeGreaterThan(50);
  });

  test('should show virtual list status when viewing table', async ({ page }) => {
    await setupDatabase(page);

    // Navigate to a table
    await page.goto('/sqlite/tables/user_settings');
    await page.waitForLoadState('networkidle');
    await unlockIfNeeded(page);

    // Wait for table heading
    await expect(page.getByRole('heading', { name: 'user_settings' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // The VirtualListStatus should be visible showing row count
    // Could be "0 rows", "X rows", "Viewing X-Y of Z rows", or "No rows in this table"
    await expect(
      page.getByText(/\d+ rows?/)
        .or(page.getByText(/Viewing \d+-\d+ of/))
    ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  /**
   * Regression test for virtualized table scroll behavior in route view.
   *
   * Previously, the scroll happened at the App/main level instead of inside
   * the TableRowsView scroll container. This broke:
   * - Virtualization (all rows rendered instead of just visible ones)
   * - Sticky VirtualListStatus (nothing stuck when scrolling)
   *
   * The fix required proper flex layout with min-h-0 and overflow-hidden
   * throughout the component hierarchy (App.tsx, TableRowsView.tsx).
   */
  test('route view should have working virtualization and bounded scroll', async ({ page }) => {
    await setupDatabase(page);

    // Generate enough data to require virtualization
    // Each db operation generates analytics events
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('db-write-button').click();
      await waitForSuccess(page);
      await page.getByTestId('db-read-button').click();
      await waitForSuccess(page);
    }

    // Navigate to analytics_events table via ROUTE (not floating window)
    await page.goto('/sqlite/tables/analytics_events');
    await page.waitForLoadState('networkidle');
    await unlockIfNeeded(page);

    // Wait for table to load
    await expect(page.getByRole('heading', { name: 'analytics_events' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Wait for scroll container
    const scrollContainer = page.getByTestId('scroll-container');
    await expect(scrollContainer).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // CRITICAL: Verify scroll container has bounded height
    // If this fails, scroll is happening at wrong level (App/main instead of scroll-container)
    const boundingBox = await scrollContainer.boundingBox();
    expect(boundingBox, 'Scroll container should exist').not.toBeNull();
    expect(
      boundingBox!.height,
      'Scroll container should have meaningful height (not collapsed)'
    ).toBeGreaterThan(100);
    expect(
      boundingBox!.height,
      'Scroll container should be bounded (less than viewport height)'
    ).toBeLessThan(700); // viewport is 800px, minus header/footer

    // CRITICAL: Verify virtualization is working
    // With proper virtualization, only visible rows + overscan are rendered
    // If all 50 rows are rendered, virtualization is broken
    const renderedRows = await page.locator('[data-index]').count();
    expect(
      renderedRows,
      'Virtualization should render fewer rows than total (only visible + overscan)'
    ).toBeLessThan(30); // Should be much less than PAGE_SIZE of 50

    // Verify VirtualListStatus shows pagination info
    await expect(
      page.getByText(/Viewing \d+-\d+ of \d+/)
    ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  /**
   * Regression test for sticky VirtualListStatus behavior.
   *
   * The VirtualListStatus should remain visible at the top of the scroll
   * container when scrolling through table rows.
   */
  test('route view should have sticky VirtualListStatus when scrolling', async ({ page }) => {
    await setupDatabase(page);

    // Generate enough data to scroll
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('db-write-button').click();
      await waitForSuccess(page);
    }

    await page.goto('/sqlite/tables/analytics_events');
    await page.waitForLoadState('networkidle');
    await unlockIfNeeded(page);

    await expect(page.getByRole('heading', { name: 'analytics_events' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    const scrollContainer = page.getByTestId('scroll-container');
    await expect(scrollContainer).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Get initial position of VirtualListStatus
    const statusText = page.getByText(/Viewing \d+-\d+ of \d+/);
    await expect(statusText).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    const initialBox = await statusText.boundingBox();
    expect(initialBox, 'VirtualListStatus should be visible initially').not.toBeNull();

    // Scroll down inside the scroll container
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 500;
    });

    // Wait for scroll to take effect
    await page.waitForTimeout(100);

    // VirtualListStatus should still be visible (sticky behavior)
    await expect(statusText).toBeVisible();

    // The status should be at approximately the same vertical position (stuck to top)
    const afterScrollBox = await statusText.boundingBox();
    expect(afterScrollBox, 'VirtualListStatus should still be visible after scroll').not.toBeNull();

    // The Y position should be similar (within scroll container's top area)
    // Allow some tolerance for the sticky positioning
    expect(
      Math.abs(afterScrollBox!.y - initialBox!.y),
      'VirtualListStatus should stay at top (sticky behavior)'
    ).toBeLessThan(50);
  });
});
