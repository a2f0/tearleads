import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage } from './test-utils';

// Helper to navigate via sidebar
async function navigateTo(page: Page, linkName: string) {
  const link = page.locator('aside nav').getByRole('link', { name: linkName });
  await link.click();
}

// Helper to setup and unlock the database
async function setupAndUnlockDatabase(page: Page, password = 'testpassword123') {
  await navigateTo(page, 'SQLite');
  await page.getByTestId('db-reset-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
    timeout: 10000
  });
  await page.getByTestId('db-password-input').fill(password);
  await page.getByTestId('db-setup-button').click();
  await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
    timeout: 10000
  });
}

// Helper to create a note and navigate to it
async function createAndOpenNote(page: Page) {
  await navigateTo(page, 'Notes');
  await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();

  // Click create note button
  const createButton = page.getByTestId('create-note-button');
  await expect(createButton).toBeVisible({ timeout: 10000 });
  await createButton.click();

  // Wait for navigation to note detail page
  await expect(page.getByTestId('markdown-editor')).toBeVisible({ timeout: 10000 });
}

// Helper to switch theme
async function switchTheme(page: Page, themeId: string) {
  await navigateTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByTestId(`theme-option-${themeId}`).click();
  // Wait for theme to apply
  await page.waitForTimeout(100);
}

// Helper to get computed background color of an element
async function getComputedBackgroundColor(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });
}

// Helper to check if a color is grayscale
// Supports both RGB format (rgb(r, g, b)) and oklch format (oklch(l c h))
function isGrayscale(colorString: string): boolean {
  // Check oklch format: oklch(lightness chroma hue)
  // Grayscale in oklch has chroma = 0
  const oklchMatch = colorString.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (oklchMatch) {
    const chroma = Number(oklchMatch[2]);
    // Chroma of 0 means grayscale
    return chroma === 0;
  }

  // Check RGB format
  const rgbMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    // Allow small variance for rounding
    return Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2;
  }

  return false;
}

// Helper to check if a color has a blue tint (for tokyo-night)
function hasBlueTint(colorString: string): boolean {
  // Check oklch format: oklch(lightness chroma hue)
  // Blue hues are around 250-280 degrees
  const oklchMatch = colorString.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (oklchMatch) {
    const chroma = Number(oklchMatch[2]);
    const hue = Number(oklchMatch[3]);
    // Has chroma > 0 and hue in blue range (approximately 250-280)
    return chroma > 0 && hue >= 250 && hue <= 290;
  }

  // Check RGB format
  const rgbMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const b = Number(rgbMatch[3]);
    // Blue tint means b >= r
    return b >= r;
  }

  return false;
}

// Helper to check if a color is dark
function isDark(colorString: string): boolean {
  // Check oklch format: oklch(lightness chroma hue)
  const oklchMatch = colorString.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (oklchMatch) {
    const lightness = Number(oklchMatch[1]);
    return lightness < 0.35;
  }

  // Check RGB format
  const rgbMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return r < 100 && g < 100 && b < 100;
  }

  return false;
}

// Helper to check if a color is light
function isLight(colorString: string): boolean {
  // Check oklch format
  const oklchMatch = colorString.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (oklchMatch) {
    const lightness = Number(oklchMatch[1]);
    return lightness > 0.85;
  }

  // Check RGB format
  const rgbMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return r > 200 && g > 200 && b > 200;
  }

  return false;
}

test.describe('Notes Editor Theme Integration', () => {
  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should apply monochrome theme colors to markdown editor', async ({ page }) => {
    // Setup database and create a note
    await setupAndUnlockDatabase(page);
    await createAndOpenNote(page);

    // Switch to monochrome theme
    await switchTheme(page, 'monochrome');

    // Navigate back to the note
    await page.goBack();
    await expect(page.getByTestId('markdown-editor')).toBeVisible({ timeout: 10000 });

    // Verify the html element has monochrome class
    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveClass(/monochrome/);

    // Get editor wrapper and check data-color-mode
    const editorWrapper = page.getByTestId('markdown-editor');
    await expect(editorWrapper).toHaveAttribute('data-color-mode', 'dark');

    // Get computed styles from the editor elements
    const editorBg = await getComputedBackgroundColor(page, '.w-md-editor');
    const toolbarBg = await getComputedBackgroundColor(page, '.w-md-editor-toolbar');
    const previewBg = await getComputedBackgroundColor(page, '.w-md-editor-preview');

    // Log for debugging
    console.log('Monochrome theme computed styles:');
    console.log('  Editor background:', editorBg);
    console.log('  Toolbar background:', toolbarBg);
    console.log('  Preview background:', previewBg);

    // Verify backgrounds are grayscale (monochrome theme)
    expect(isGrayscale(editorBg)).toBe(true);
    expect(isGrayscale(toolbarBg)).toBe(true);
    expect(isGrayscale(previewBg)).toBe(true);
  });

  test('should apply tokyo-night theme colors to markdown editor', async ({ page }) => {
    // Setup database and create a note
    await setupAndUnlockDatabase(page);
    await createAndOpenNote(page);

    // Switch to tokyo-night theme
    await switchTheme(page, 'tokyo-night');

    // Navigate back to the note
    await page.goBack();
    await expect(page.getByTestId('markdown-editor')).toBeVisible({ timeout: 10000 });

    // Verify the html element has tokyo-night class
    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveClass(/tokyo-night/);

    // Get editor wrapper and check data-color-mode
    const editorWrapper = page.getByTestId('markdown-editor');
    await expect(editorWrapper).toHaveAttribute('data-color-mode', 'dark');

    // Get computed styles from the editor elements
    const editorBg = await getComputedBackgroundColor(page, '.w-md-editor');
    const toolbarBg = await getComputedBackgroundColor(page, '.w-md-editor-toolbar');

    // Log for debugging
    console.log('Tokyo Night theme computed styles:');
    console.log('  Editor background:', editorBg);
    console.log('  Toolbar background:', toolbarBg);

    // Tokyo Night should be dark with a blue tint (not pure grayscale)
    expect(isDark(editorBg)).toBe(true);
    expect(hasBlueTint(editorBg)).toBe(true);
  });

  test('should apply light theme colors to markdown editor', async ({ page }) => {
    // Setup database and create a note
    await setupAndUnlockDatabase(page);
    await createAndOpenNote(page);

    // Switch to light theme
    await switchTheme(page, 'light');

    // Navigate back to the note
    await page.goBack();
    await expect(page.getByTestId('markdown-editor')).toBeVisible({ timeout: 10000 });

    // Verify the html element has light class
    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveClass(/light/);

    // Get editor wrapper and check data-color-mode
    const editorWrapper = page.getByTestId('markdown-editor');
    await expect(editorWrapper).toHaveAttribute('data-color-mode', 'light');

    // Get computed styles from the editor elements
    const editorBg = await getComputedBackgroundColor(page, '.w-md-editor');

    // Log for debugging
    console.log('Light theme computed styles:');
    console.log('  Editor background:', editorBg);

    // Light theme should have a light background
    expect(isLight(editorBg)).toBe(true);
  });

  test('should apply dark theme colors to markdown editor', async ({ page }) => {
    // Setup database and create a note
    await setupAndUnlockDatabase(page);
    await createAndOpenNote(page);

    // Switch to dark theme
    await switchTheme(page, 'dark');

    // Navigate back to the note
    await page.goBack();
    await expect(page.getByTestId('markdown-editor')).toBeVisible({ timeout: 10000 });

    // Verify the html element has dark class
    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveClass(/dark/);

    // Get editor wrapper and check data-color-mode
    const editorWrapper = page.getByTestId('markdown-editor');
    await expect(editorWrapper).toHaveAttribute('data-color-mode', 'dark');

    // Get computed styles from the editor elements
    const editorBg = await getComputedBackgroundColor(page, '.w-md-editor');

    // Log for debugging
    console.log('Dark theme computed styles:');
    console.log('  Editor background:', editorBg);

    // Dark theme should be dark and grayscale
    expect(isDark(editorBg)).toBe(true);
    expect(isGrayscale(editorBg)).toBe(true);
  });

  test('should have different backgrounds for monochrome vs tokyo-night', async ({ page }) => {
    // Setup database and create a note
    await setupAndUnlockDatabase(page);
    await createAndOpenNote(page);

    // Get monochrome background
    await switchTheme(page, 'monochrome');
    await page.goBack();
    await expect(page.getByTestId('markdown-editor')).toBeVisible({ timeout: 10000 });
    const monochromeBg = await getComputedBackgroundColor(page, '.w-md-editor');
    console.log('Monochrome background:', monochromeBg);

    // Get tokyo-night background
    await switchTheme(page, 'tokyo-night');
    await page.goBack();
    await expect(page.getByTestId('markdown-editor')).toBeVisible({ timeout: 10000 });
    const tokyoNightBg = await getComputedBackgroundColor(page, '.w-md-editor');
    console.log('Tokyo Night background:', tokyoNightBg);

    // They should be different (monochrome is pure grayscale, tokyo-night has blue tint)
    expect(monochromeBg).not.toEqual(tokyoNightBg);
  });
});
