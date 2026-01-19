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

test.describe('Bottom Sheet (Electron)', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    electronApp = await launchElectronApp();
    window = await electronApp.firstWindow();
    await window.bringToFront();

    // Wait for app to load - verify Start button is visible
    const startButton = window.getByTestId('start-button');
    await expect(startButton).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    // Resize to a mobile-like viewport so settings uses the bottom sheet.
    await window.setViewportSize({ width: 600, height: 900 });

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

  test('should increase height when dragged upward', async () => {
    const initialHeight = await getSheetHeight(window);

    // Drag the handle upward (negative deltaY)
    await dragHandle(window, -100);

    await expect.poll(async () => getSheetHeight(window)).toBeGreaterThan(
      initialHeight
    );
  });

  test('should decrease height when dragged downward', async () => {
    // First expand the sheet by dragging up
    await dragHandle(window, -150);
    await waitForStableHeight(window);

    const expandedHeight = await getSheetHeight(window);

    // Now drag down
    await dragHandle(window, 100);
    await expect.poll(async () => getSheetHeight(window)).toBeLessThan(
      expandedHeight
    );
  });

  test('should dismiss when dragged down quickly', async () => {
    // Quick movement (fewer steps = faster = higher velocity)
    await dragHandle(window, 200, { steps: 2 });

    // Sheet should be closed
    await expect(
      window.getByTestId('settings-sheet-content')
    ).toBeHidden();
  });

  test('should close when backdrop is clicked', async () => {
    // Click the backdrop
    await window.getByTestId('settings-sheet-backdrop').click();

    // Sheet should be closed
    await expect(
      window.getByTestId('settings-sheet-content')
    ).toBeHidden();
  });

  test('should close when Escape key is pressed', async () => {
    // Press Escape
    await window.keyboard.press('Escape');

    // Sheet should be closed
    await expect(
      window.getByTestId('settings-sheet-content')
    ).toBeHidden();
  });
});
