import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

/**
 * Get the current height of the bottom sheet
 */
async function getSheetHeight(page: Page): Promise<number> {
  const sheet = page.getByTestId('settings-sheet-content');
  const box = await sheet.boundingBox();
  return box?.height ?? 0;
}

async function waitForStableHeight(
  page: Page,
  {
    timeout = 1500,
    interval = 50,
    tolerance = 1,
    stableSamples = 3
  }: {
    timeout?: number;
    interval?: number;
    tolerance?: number;
    stableSamples?: number;
  } = {}
) {
  let lastHeight = await getSheetHeight(page);
  let stableCount = 0;

  await expect
    .poll(
      async () => {
        const currentHeight = await getSheetHeight(page);
        const delta = Math.abs(currentHeight - lastHeight);
        lastHeight = currentHeight;
        stableCount = delta <= tolerance ? stableCount + 1 : 0;
        return stableCount >= stableSamples;
      },
      { timeout, intervals: [interval] }
    )
    .toBe(true);
}

/**
 * Simulate a drag on the resize handle.
 * Uses dispatchEvent to trigger mousedown (which adds document listeners),
 * then Playwright's mouse API for movement and release.
 */
async function dragHandle(
  page: Page,
  deltaY: number,
  { steps = 10 }: { steps?: number } = {}
) {
  const handle = page.getByTestId('settings-sheet-resize-handle');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Handle not found');

  const startX = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height / 2);

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // Use Playwright mouse API for movement (document listeners capture these)
  for (let i = 1; i <= steps; i++) {
    const currentY = Math.round(startY + (deltaY * i) / steps);
    await page.mouse.move(startX, currentY);
  }

  await page.mouse.up();
}

test.describe('Bottom Sheet', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
    // Open the settings sheet
    await page.getByTestId('settings-button').click();
    // Wait for the bottom sheet to be visible
    await expect(page.getByTestId('settings-sheet-content')).toBeVisible();
  });

  test('should display the settings sheet with resize handle', async ({
    page
  }) => {
    // Verify the bottom sheet is visible
    await expect(page.getByTestId('settings-sheet')).toBeVisible();

    // Verify the resize handle is visible
    const handle = page.getByTestId('settings-sheet-resize-handle');
    await expect(handle).toBeVisible();

    // Verify the resize handle has the correct cursor style
    const cursor = await handle.evaluate((el) =>
      window.getComputedStyle(el).cursor
    );
    expect(cursor).toBe('ns-resize');
  });

  test('should increase height when dragged upward', async ({ page }) => {
    const initialHeight = await getSheetHeight(page);

    // Drag the handle upward (negative deltaY)
    await dragHandle(page, -100);

    await expect.poll(async () => getSheetHeight(page)).toBeGreaterThan(
      initialHeight
    );
  });

  test('should decrease height when dragged downward', async ({ page }) => {
    // First expand the sheet by dragging up
    await dragHandle(page, -150);
    await waitForStableHeight(page);

    const expandedHeight = await getSheetHeight(page);

    // Now drag down
    await dragHandle(page, 100);
    await expect.poll(async () => getSheetHeight(page)).toBeLessThan(
      expandedHeight
    );
  });

  test('should snap to nearest snap point after slow release', async ({
    page
  }) => {
    // Drag up slightly and release slowly (below velocity threshold)
    await dragHandle(page, -50);

    // Should snap back to nearest snap point (collapsed in this case)
    // Height should be at a snap point (200 is collapsed, half is ~window.height/2)
    // Since we only dragged 50px, it should snap back to collapsed (200)
    await expect.poll(async () => getSheetHeight(page)).toBeGreaterThanOrEqual(
      180
    );
    await expect.poll(async () => getSheetHeight(page)).toBeLessThanOrEqual(220);
  });

  test('should dismiss when dragged down quickly', async ({ page }) => {
    // Quick movement (fewer steps = faster = higher velocity)
    await dragHandle(page, 200, { steps: 2 });

    // Sheet should be closed
    await expect(page.getByTestId('settings-sheet-content')).toBeHidden();
  });

  test('should close when backdrop is clicked', async ({ page }) => {
    // Click the backdrop
    await page.getByTestId('settings-sheet-backdrop').click();

    // Sheet should be closed
    await expect(page.getByTestId('settings-sheet-content')).toBeHidden();
  });

  test('should close when Escape key is pressed', async ({ page }) => {
    // Press Escape
    await page.keyboard.press('Escape');

    // Sheet should be closed
    await expect(page.getByTestId('settings-sheet-content')).toBeHidden();
  });

  test('resize handle should be keyboard accessible', async ({ page }) => {
    const handle = page.getByTestId('settings-sheet-resize-handle');

    // Verify the handle has tabindex for keyboard access
    await expect(handle).toHaveAttribute('tabindex', '0');

    // Verify it has the slider role
    await expect(handle).toHaveAttribute('role', 'slider');
  });
});
