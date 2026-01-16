import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

/**
 * Get the current dimensions and position of the HUD dialog
 */
async function getHUDDimensions(page: Page) {
  const dialog = page.getByRole('dialog', { name: "Head's Up Display" });
  const box = await dialog.boundingBox();
  return {
    width: box?.width ?? 0,
    height: box?.height ?? 0,
    x: box?.x ?? 0,
    y: box?.y ?? 0
  };
}

/**
 * Simulate a corner resize drag on the HUD.
 * Uses Playwright's mouse API to trigger the resize handlers.
 */
async function dragCorner(
  page: Page,
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  deltaX: number,
  deltaY: number,
  { steps = 10 }: { steps?: number } = {}
) {
  const handle = page.getByTestId(`hud-resize-handle-${corner}`);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Resize handle ${corner} not found`);

  const startX = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height / 2);

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // Use Playwright mouse API for movement (document listeners capture these)
  for (let i = 1; i <= steps; i++) {
    const currentX = Math.round(startX + (deltaX * i) / steps);
    const currentY = Math.round(startY + (deltaY * i) / steps);
    await page.mouse.move(currentX, currentY);
  }

  await page.mouse.up();
}

/**
 * Simulate a title bar drag to move the HUD.
 */
async function dragTitleBar(
  page: Page,
  deltaX: number,
  deltaY: number,
  { steps = 10 }: { steps?: number } = {}
) {
  const titleBar = page.getByTestId('hud-title-bar');
  await expect(titleBar).toBeVisible();
  const box = await titleBar.boundingBox();
  if (!box) throw new Error('Title bar not found');

  const startX = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height / 2);

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  for (let i = 1; i <= steps; i++) {
    const currentX = Math.round(startX + (deltaX * i) / steps);
    const currentY = Math.round(startY + (deltaY * i) / steps);
    await page.mouse.move(currentX, currentY);
  }

  await page.mouse.up();
}

test.describe('HUD Floating Window', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
    // Set viewport to ensure desktop mode
    await page.setViewportSize({ width: 1280, height: 800 });
    // Open the HUD by clicking the trigger button
    await page.getByRole('button', { name: 'Open HUD' }).click();
    // Wait for the HUD dialog to be visible
    await expect(
      page.getByRole('dialog', { name: "Head's Up Display" })
    ).toBeVisible();
  });

  test('should display the HUD with all 4 resize handles', async ({ page }) => {
    // Verify all 4 corner handles are visible
    await expect(page.getByTestId('hud-resize-handle-top-left')).toBeVisible();
    await expect(page.getByTestId('hud-resize-handle-top-right')).toBeVisible();
    await expect(
      page.getByTestId('hud-resize-handle-bottom-left')
    ).toBeVisible();
    await expect(
      page.getByTestId('hud-resize-handle-bottom-right')
    ).toBeVisible();
  });

  test('should increase size when bottom-right corner is dragged outward', async ({
    page
  }) => {
    const initial = await getHUDDimensions(page);

    // Drag bottom-right corner outward (positive X and Y)
    await dragCorner(page, 'bottom-right', 100, 100);

    const final = await getHUDDimensions(page);

    // Width and height should increase
    expect(final.width).toBeGreaterThan(initial.width);
    expect(final.height).toBeGreaterThan(initial.height);
  });

  test('should decrease size when bottom-right corner is dragged inward', async ({
    page
  }) => {
    const initial = await getHUDDimensions(page);

    // Drag bottom-right corner inward (negative X and Y)
    await dragCorner(page, 'bottom-right', -50, -50);

    const final = await getHUDDimensions(page);

    // Width and height should decrease (but stay above minimum)
    expect(final.width).toBeLessThan(initial.width);
    expect(final.height).toBeLessThan(initial.height);
  });

  test('should resize and move position when top-left corner is dragged', async ({
    page
  }) => {
    const initial = await getHUDDimensions(page);

    // Drag top-left corner outward (negative X and Y = expands and moves)
    await dragCorner(page, 'top-left', -50, -50);

    const final = await getHUDDimensions(page);

    // Width and height should increase
    expect(final.width).toBeGreaterThan(initial.width);
    expect(final.height).toBeGreaterThan(initial.height);
    // Position should move (x and y should decrease)
    expect(final.x).toBeLessThan(initial.x);
    expect(final.y).toBeLessThan(initial.y);
  });

  test('should move when title bar is dragged', async ({ page }) => {
    const initial = await getHUDDimensions(page);

    // Drag title bar to move the window
    await dragTitleBar(page, -100, -50);

    const final = await getHUDDimensions(page);

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

    const final = await getHUDDimensions(page);

    // Should not go below minimum (280x150)
    expect(final.width).toBeGreaterThanOrEqual(280);
    expect(final.height).toBeGreaterThanOrEqual(150);
  });

  test('should close when backdrop is clicked', async ({ page }) => {
    await page.getByTestId('hud-backdrop').click();
    await expect(
      page.getByRole('dialog', { name: "Head's Up Display" })
    ).toBeHidden();
  });

  test('should close when X button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Close HUD' }).click();
    await expect(
      page.getByRole('dialog', { name: "Head's Up Display" })
    ).toBeHidden();
  });
});
