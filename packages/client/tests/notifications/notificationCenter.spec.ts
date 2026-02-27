import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

/**
 * Corner type for resize handles.
 * Must stay in sync with Corner type exported from @/hooks/useFloatingWindow
 */
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Notification Center minimum size constraints.
 * Must stay in sync with MIN_WIDTH/MIN_HEIGHT from @/components/notification-center/constants
 */
const MIN_WIDTH = 480;
const MIN_HEIGHT = 300;

/**
 * Get the current dimensions and position of the Notification Center dialog
 */
async function getNotificationCenterDimensions(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Notification Center' });
  const box = await dialog.boundingBox();
  return {
    width: box?.width ?? 0,
    height: box?.height ?? 0,
    x: box?.x ?? 0,
    y: box?.y ?? 0
  };
}

/**
 * Simulate a mouse drag operation from a starting position.
 * Uses Playwright's mouse API to trigger drag handlers.
 */
async function simulateDrag(
  page: Page,
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  { steps = 10 }: { steps?: number } = {}
) {
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  for (let i = 1; i <= steps; i++) {
    const currentX = Math.round(startX + (deltaX * i) / steps);
    const currentY = Math.round(startY + (deltaY * i) / steps);
    await page.mouse.move(currentX, currentY);
  }

  await page.mouse.up();
}

/**
 * Simulate a corner resize drag on the Notification Center.
 */
async function dragCorner(
  page: Page,
  corner: Corner,
  deltaX: number,
  deltaY: number,
  { steps = 10 }: { steps?: number } = {}
) {
  // Match the resize handle with dynamic window ID (e.g., notification-center-1)
  const handle = page.locator(
    `[data-testid^="floating-window-notification-center-"][data-testid$="-resize-handle-${corner}"]`
  );
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Resize handle ${corner} not found`);

  const startX = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height / 2);

  await simulateDrag(page, startX, startY, deltaX, deltaY, { steps });
}

/**
 * Simulate a title bar drag to move the Notification Center.
 */
async function dragTitleBar(
  page: Page,
  deltaX: number,
  deltaY: number,
  { steps = 10 }: { steps?: number } = {}
) {
  // Match the title bar with dynamic window ID (e.g., notification-center-1)
  const titleBar = page.locator(
    '[data-testid^="floating-window-notification-center-"][data-testid$="-title-bar"]'
  );
  await expect(titleBar).toBeVisible();
  const box = await titleBar.boundingBox();
  if (!box) throw new Error('Title bar not found');

  const startX = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height / 2);

  await simulateDrag(page, startX, startY, deltaX, deltaY, { steps });
}

test.describe('Notification Center Floating Window', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
    // Set viewport to ensure desktop mode
    await page.setViewportSize({ width: 1280, height: 800 });
    // Open the Notification Center by clicking the trigger button
    await page.getByRole('button', { name: 'Open Notification Center' }).click();
    // Wait for the Notification Center dialog to be visible
    await expect(
      page.getByRole('dialog', { name: 'Notification Center' })
    ).toBeVisible();
  });

  test('should display the Notification Center with all 4 resize handles', async ({ page }) => {
    // Verify all 4 corner handles are visible (using pattern for dynamic window ID)
    await expect(
      page.locator('[data-testid^="floating-window-notification-center-"][data-testid$="-resize-handle-top-left"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="floating-window-notification-center-"][data-testid$="-resize-handle-top-right"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="floating-window-notification-center-"][data-testid$="-resize-handle-bottom-left"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="floating-window-notification-center-"][data-testid$="-resize-handle-bottom-right"]')
    ).toBeVisible();
  });

  test('should increase size when bottom-right corner is dragged outward', async ({
    page
  }) => {
    const initial = await getNotificationCenterDimensions(page);

    // Drag bottom-right corner outward (positive X and Y)
    await dragCorner(page, 'bottom-right', 100, 100);

    const final = await getNotificationCenterDimensions(page);

    // Width and height should increase
    expect(final.width).toBeGreaterThan(initial.width);
    expect(final.height).toBeGreaterThan(initial.height);
  });

  test('should decrease size when bottom-right corner is dragged inward', async ({
    page
  }) => {
    const initial = await getNotificationCenterDimensions(page);

    // Drag bottom-right corner inward (negative X and Y)
    await dragCorner(page, 'bottom-right', -50, -50);

    const final = await getNotificationCenterDimensions(page);

    // Width and height should decrease (but stay above minimum)
    expect(final.width).toBeLessThan(initial.width);
    expect(final.height).toBeLessThan(initial.height);
  });

  test('should resize and move position when top-left corner is dragged', async ({
    page
  }) => {
    const initial = await getNotificationCenterDimensions(page);

    // Drag top-left corner outward (negative X and Y = expands and moves)
    await dragCorner(page, 'top-left', -50, -50);

    const final = await getNotificationCenterDimensions(page);

    // Width and height should increase
    expect(final.width).toBeGreaterThan(initial.width);
    expect(final.height).toBeGreaterThan(initial.height);
    // Position should move (x and y should decrease)
    expect(final.x).toBeLessThan(initial.x);
    expect(final.y).toBeLessThan(initial.y);
  });

  test('should move when title bar is dragged', async ({ page }) => {
    const initial = await getNotificationCenterDimensions(page);

    // Drag title bar to move the window
    await dragTitleBar(page, -100, -50);

    const final = await getNotificationCenterDimensions(page);

    // Position should change
    expect(final.x).toBeLessThan(initial.x);
    expect(final.y).toBeLessThan(initial.y);
    // Size should stay the same
    expect(final.width).toBe(initial.width);
    expect(final.height).toBe(initial.height);
  });

  test('should respect minimum size constraints', async ({ page }) => {
    // Drag bottom-right corner way inward to test minimum size
    await dragCorner(page, 'bottom-right', -500, -500);

    const final = await getNotificationCenterDimensions(page);

    // Should not go below minimum constraints
    expect(final.width).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(final.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
  });

  test('should close when X button is clicked', async ({ page }) => {
    // Use dispatchEvent to avoid resize handle intercepting click
    await page
      .getByRole('button', { name: 'Close Notification Center' })
      .dispatchEvent('click');
    await expect(
      page.getByRole('dialog', { name: 'Notification Center' })
    ).toBeHidden();
  });
});
