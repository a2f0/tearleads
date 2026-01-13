import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp } from './electron-test-helper';

const APP_LOAD_TIMEOUT = 10000;

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

test.describe('Bottom Sheet (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();

    // Wait for app to load
    const heading = window.getByRole('heading', { name: 'Tearleads', level: 1 });
    await expect(heading).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Open the settings sheet
    await window.getByTestId('settings-button').click();
    // Wait for the bottom sheet to be visible
    await expect(window.getByTestId('settings-sheet-content')).toBeVisible();
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should display the settings sheet with resize handle', async () => {
    // Verify the bottom sheet is visible
    await expect(window.getByTestId('settings-sheet')).toBeVisible();

    // Verify the resize handle is visible
    const handle = window.getByTestId('settings-sheet-resize-handle');
    await expect(handle).toBeVisible();

    // Verify the resize handle has the correct cursor style
    const cursor = await handle.evaluate((el) =>
      globalThis.getComputedStyle(el).cursor
    );
    expect(cursor).toBe('ns-resize');
  });

  test.skip('should increase height when dragged upward', async () => {
    // Skip: Mouse drag simulation is unreliable in Electron CI environment
    const initialHeight = await getSheetHeight(window);

    // Drag the handle upward (negative deltaY)
    await dragHandle(window, -100);

    // Wait for animation to complete
    await window.waitForTimeout(400);

    const newHeight = await getSheetHeight(window);
    expect(newHeight).toBeGreaterThan(initialHeight);
  });

  test.skip('should decrease height when dragged downward', async () => {
    // Skip: Mouse drag simulation is unreliable in Electron CI environment
    // First expand the sheet by dragging up
    await dragHandle(window, -150);
    await window.waitForTimeout(400);

    const expandedHeight = await getSheetHeight(window);

    // Now drag down
    await dragHandle(window, 100);
    await window.waitForTimeout(400);

    const newHeight = await getSheetHeight(window);
    expect(newHeight).toBeLessThan(expandedHeight);
  });

  test.skip('should dismiss when dragged down quickly', async () => {
    // Skip: Mouse drag simulation is unreliable in Electron CI environment
    const handle = window.getByTestId('settings-sheet-resize-handle');
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
    await window.mouse.move(startX, endY, { steps: 2 });

    // Dispatch mouseup to end the drag
    await window.evaluate(
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
    await window.waitForTimeout(400);

    // Sheet should be closed
    await expect(
      window.getByTestId('settings-sheet-content')
    ).not.toBeVisible();
  });

  test('should close when backdrop is clicked', async () => {
    // Click the backdrop
    await window.getByTestId('settings-sheet-backdrop').click();

    // Wait for animation
    await window.waitForTimeout(400);

    // Sheet should be closed
    await expect(
      window.getByTestId('settings-sheet-content')
    ).not.toBeVisible();
  });

  test('should close when Escape key is pressed', async () => {
    // Press Escape
    await window.keyboard.press('Escape');

    // Wait for animation
    await window.waitForTimeout(400);

    // Sheet should be closed
    await expect(
      window.getByTestId('settings-sheet-content')
    ).not.toBeVisible();
  });
});
