import { test, expect, Page } from '@playwright/test';

/**
 * Get the current height of the bottom sheet
 */
async function getSheetHeight(page: Page): Promise<number> {
  const sheet = page.getByTestId('settings-sheet-content');
  const box = await sheet.boundingBox();
  return box?.height ?? 0;
}

/**
 * Simulate a drag on the resize handle.
 * Uses dispatchEvent to trigger mousedown (which adds document listeners),
 * then Playwright's mouse API for movement and release.
 */
async function dragHandle(page: Page, deltaY: number) {
  const handle = page.getByTestId('settings-sheet-resize-handle');
  const box = await handle.boundingBox();
  if (!box) throw new Error('Handle not found');

  const startX = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height / 2);

  // Dispatch mousedown to start the drag (triggers document-level listeners)
  await handle.evaluate(
    (el, { x, y }) => {
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1
      });
      el.dispatchEvent(event);
    },
    { x: startX, y: startY }
  );

  // Small delay to ensure handlers are set up
  await page.waitForTimeout(50);

  // Use Playwright mouse API for movement (document listeners capture these)
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const currentY = Math.round(startY + (deltaY * i) / steps);
    await page.mouse.move(startX, currentY);
    await page.waitForTimeout(30);
  }

  // Dispatch mouseup to end the drag
  await page.evaluate(
    ({ x, y }) => {
      const event = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 0
      });
      document.dispatchEvent(event);
    },
    { x: startX, y: startY + deltaY }
  );

  // Wait for React state updates and any snap animation
  await page.waitForTimeout(350);
}

test.describe('Bottom Sheet', () => {
  test.beforeEach(async ({ page }) => {
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

    const newHeight = await getSheetHeight(page);
    expect(newHeight).toBeGreaterThan(initialHeight);
  });

  test('should decrease height when dragged downward', async ({ page }) => {
    // First expand the sheet by dragging up
    await dragHandle(page, -150);
    await page.waitForTimeout(400);

    const expandedHeight = await getSheetHeight(page);

    // Now drag down
    await dragHandle(page, 100);
    await page.waitForTimeout(400);

    const newHeight = await getSheetHeight(page);
    expect(newHeight).toBeLessThan(expandedHeight);
  });

  test('should snap to nearest snap point after slow release', async ({
    page
  }) => {
    // Drag up slightly and release slowly (below velocity threshold)
    await dragHandle(page, -50);

    // Should snap back to nearest snap point (collapsed in this case)
    const snappedHeight = await getSheetHeight(page);

    // Height should be at a snap point (200 is collapsed, half is ~window.height/2)
    // Since we only dragged 50px, it should snap back to collapsed (200)
    expect(snappedHeight).toBeGreaterThanOrEqual(180);
    expect(snappedHeight).toBeLessThanOrEqual(220);
  });

  test('should dismiss when dragged down quickly', async ({ page }) => {
    const handle = page.getByTestId('settings-sheet-resize-handle');
    const box = await handle.boundingBox();
    if (!box) throw new Error('Handle not found');

    const startX = Math.round(box.x + box.width / 2);
    const startY = Math.round(box.y + box.height / 2);
    const endY = startY + 200;

    // Dispatch mousedown to start the drag
    await handle.evaluate(
      (el, { x, y }) => {
        const event = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1
        });
        el.dispatchEvent(event);
      },
      { x: startX, y: startY }
    );

    // Quick movement (fewer steps = faster = higher velocity)
    await page.mouse.move(startX, endY, { steps: 2 });

    // Dispatch mouseup to end the drag
    await page.evaluate(
      ({ x, y }) => {
        const event = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 0
        });
        document.dispatchEvent(event);
      },
      { x: startX, y: endY }
    );

    // Wait for animation
    await page.waitForTimeout(400);

    // Sheet should be closed
    await expect(page.getByTestId('settings-sheet-content')).not.toBeVisible();
  });

  test('should close when backdrop is clicked', async ({ page }) => {
    // Click the backdrop
    await page.getByTestId('settings-sheet-backdrop').click();

    // Wait for animation
    await page.waitForTimeout(400);

    // Sheet should be closed
    await expect(page.getByTestId('settings-sheet-content')).not.toBeVisible();
  });

  test('should close when Escape key is pressed', async ({ page }) => {
    // Press Escape
    await page.keyboard.press('Escape');

    // Wait for animation
    await page.waitForTimeout(400);

    // Sheet should be closed
    await expect(page.getByTestId('settings-sheet-content')).not.toBeVisible();
  });

  test('resize handle should be keyboard accessible', async ({ page }) => {
    const handle = page.getByTestId('settings-sheet-resize-handle');

    // Verify the handle has tabindex for keyboard access
    await expect(handle).toHaveAttribute('tabindex', '0');

    // Verify it has the slider role
    await expect(handle).toHaveAttribute('role', 'slider');
  });
});
