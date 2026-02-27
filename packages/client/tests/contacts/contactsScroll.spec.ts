import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const TEST_PASSWORD = 'testpassword123';
const DB_OPERATION_TIMEOUT = 15000;
const PAGE_LOAD_TIMEOUT = 5000;

test.beforeEach(async ({ page }) => {
  await clearOriginStorage(page);
});

// Helper to navigate to SQLite page and setup database
async function setupDatabase(page: Page): Promise<void> {
  await page.goto('/sqlite');
  await page.getByTestId('db-reset-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
    timeout: DB_OPERATION_TIMEOUT
  });
  await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
}

// Helper to unlock via inline unlock component if database is locked after page navigation
async function unlockIfNeeded(page: Page): Promise<void> {
  // Wait for page to stabilize
  await page.waitForLoadState('domcontentloaded');

  // Check if inline unlock component appears (wait briefly)
  const inlineUnlock = page.getByTestId('inline-unlock');
  try {
    await expect(inlineUnlock).toBeVisible({ timeout: 5000 });
  } catch {
    // Not locked, nothing to do
    return;
  }

  // Fill password using the correct test ID
  const passwordInput = page.getByTestId('inline-unlock-password');
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
  await passwordInput.fill(TEST_PASSWORD);

  // Click unlock button using the correct test ID
  const unlockButton = page.getByTestId('inline-unlock-button');
  await expect(unlockButton).toBeEnabled({ timeout: 5000 });
  await unlockButton.click();

  // Wait for unlock to complete (inline unlock should disappear)
  await expect(inlineUnlock).not.toBeVisible({
    timeout: DB_OPERATION_TIMEOUT
  });
}

test.describe('Contacts Page', () => {
  /**
   * Test for sticky scroll behavior on the contacts page.
   * The VirtualListStatus line should remain visible when scrolling down
   * through the contacts list.
   */
  test('should keep status line sticky when scrolling', async ({ page }) => {
    // Use a very small viewport to ensure content is scrollable with fewer contacts
    await page.setViewportSize({ width: 1280, height: 400 });

    await setupDatabase(page);

    // Navigate to contacts page
    await page.goto('/contacts');
    await unlockIfNeeded(page);

    // Verify we're on the contacts page
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT
    });

    // Create several test contacts to ensure scrollable content
    for (let i = 0; i < 10; i++) {
      // Wait for add-contact-card to be stable and enabled
      const addCard = page.getByTestId('add-contact-card');
      await addCard.waitFor({ state: 'visible', timeout: PAGE_LOAD_TIMEOUT });
      await expect(addCard).toBeEnabled();
      await addCard.click();

      // Wait for the new contact form to load
      await expect(page.getByTestId('new-first-name')).toBeVisible({
        timeout: PAGE_LOAD_TIMEOUT
      });

      await page.getByTestId('new-first-name').fill(`Test${i}`);
      await page.getByTestId('new-last-name').fill(`Contact${i}`);
      await page.getByTestId('save-button').click();

      // Wait for save to complete - navigates to contact detail
      await expect(
        page.getByRole('heading', { name: `Test${i}` })
      ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

      // Navigate back to contacts list via Back link
      await page.getByRole('link', { name: /Back to Contacts/i }).click();

      // Wait for contacts list to fully load
      await expect(
        page.getByRole('heading', { name: 'Contacts' })
      ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
      // Wait for contacts to finish loading (virtual list status should appear after first contact)
      if (i > 0) {
        await expect(page.getByTestId('virtual-list-status')).toBeVisible({
          timeout: PAGE_LOAD_TIMEOUT
        });
      }
    }

    // Wait for contacts to load and virtual list status to appear
    const virtualListStatus = page.getByTestId('virtual-list-status');
    await expect(virtualListStatus).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Find the scroll container
    const scrollContainer = page.getByTestId('contacts-scroll-container');
    await expect(scrollContainer).toBeVisible();

    // Get initial position of the status line
    const statusBoundingBoxBefore = await virtualListStatus.boundingBox();
    expect(statusBoundingBoxBefore).not.toBeNull();

    // Check if the scroll container is actually scrollable
    const scrollInfo = await scrollContainer.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      isScrollable: el.scrollHeight > el.clientHeight
    }));

    expect(
      scrollInfo.isScrollable,
      `Scroll container should be scrollable (scrollHeight: ${scrollInfo.scrollHeight}, clientHeight: ${scrollInfo.clientHeight})`
    ).toBe(true);

    // Get position of sticky element relative to scroll container
    const stickyOffsetTop = await page.evaluate(() => {
      const scrollContainer = document.querySelector(
        '[data-testid="contacts-scroll-container"]'
      );
      const stickyEl = document.querySelector(
        '[data-testid="contacts-sticky-header"]'
      );
      if (!scrollContainer || !stickyEl) return 0;
      return (stickyEl as HTMLElement).offsetTop;
    });

    // Scroll past the sticky element's initial position to trigger sticky
    const scrollAmount = stickyOffsetTop + 200;
    await scrollContainer.evaluate((el, amount) => {
      el.scrollTop = amount;
    }, scrollAmount);

    // Wait for next animation frame to ensure scroll completes
    await page.evaluate(() => new Promise(requestAnimationFrame));

    // Check scroll position after
    const scrollTopAfter = await scrollContainer.evaluate((el) => el.scrollTop);

    // Verify we actually scrolled
    expect(scrollTopAfter, 'Should have scrolled down').toBeGreaterThan(0);

    // Verify status line is still visible after scrolling
    await expect(virtualListStatus).toBeVisible();

    // Get bounding box after scrolling
    const statusBoundingBoxAfter = await virtualListStatus.boundingBox();
    expect(statusBoundingBoxAfter).not.toBeNull();

    const statusYBefore = statusBoundingBoxBefore?.y ?? 0;
    const statusYAfter = statusBoundingBoxAfter?.y ?? 0;

    // The scroll container starts below headers (not at top of viewport).
    // If sticky is working, the status line stays at the same Y position (top of scroll container)
    // regardless of scroll position within the container.
    // Without sticky, it would have scrolled up and out of view (negative Y or much lower Y).
    expect(
      statusYAfter,
      `Status line should be visible (sticky) after scroll - Y=${statusYAfter}`
    ).toBeGreaterThan(0);

    // Sticky keeps the status line at approximately the same position.
    // Allow for small variance (padding, rendering differences).
    // Without sticky, the element would move up by the scroll amount.
    const expectedYWithoutSticky = statusYBefore - scrollTopAfter;
    expect(
      statusYAfter,
      `Status line should be sticky (Y stayed at ${statusYAfter}, not moved to ${expectedYWithoutSticky})`
    ).toBeGreaterThan(expectedYWithoutSticky + 50); // If it moved significantly up, sticky isn't working

    // The Y position should be close to where it started (within the scroll container top area)
    expect(
      Math.abs(statusYAfter - statusYBefore),
      `Status line Y should stay near original position. Before: ${statusYBefore}, After: ${statusYAfter}`
    ).toBeLessThan(50);
  });
});
