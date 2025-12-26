/**
 * Navigation helper for moving between app pages
 */

import { switchToWebViewContext } from '../helpers/webview-helpers.js';

// Navigation test IDs
const NAV_LINKS = {
  home: 'home-link',
  tables: 'tables-link',
  debug: 'debug-link',
  settings: 'settings-link',
} as const;

type PageName = keyof typeof NAV_LINKS;

/**
 * Navigate to a specific page
 */
export async function navigateTo(page: PageName): Promise<void> {
  await switchToWebViewContext();
  const testId = NAV_LINKS[page];
  const link = await $(`[data-testid="${testId}"]`);
  await link.waitForExist({ timeout: 10000 });
  await link.click();

  // Wait for destination page element to exist
  const pageIndicators: Record<PageName, string> = {
    home: 'dropzone',
    tables: 'tables-page',
    debug: 'database-test',
    settings: 'dark-mode-switch',
  };
  const indicator = pageIndicators[page];
  const destElement = await $(`[data-testid="${indicator}"]`);
  await destElement.waitForExist({ timeout: 10000 });
}

/**
 * Navigate to home page
 */
export async function goToHome(): Promise<void> {
  await navigateTo('home');
}

/**
 * Navigate to tables page
 */
export async function goToTables(): Promise<void> {
  await navigateTo('tables');
}

/**
 * Navigate to debug page
 */
export async function goToDebug(): Promise<void> {
  await navigateTo('debug');
}

/**
 * Navigate to settings page
 */
export async function goToSettings(): Promise<void> {
  await navigateTo('settings');
}

/**
 * Check if we're on a specific page by looking for a characteristic element
 */
export async function isOnPage(page: PageName): Promise<boolean> {
  await switchToWebViewContext();

  // Each page has characteristic elements we can check for
  const pageIndicators: Record<PageName, string> = {
    home: 'dropzone',
    tables: 'tables-page',
    debug: 'database-test',
    settings: 'dark-mode-switch',
  };

  const indicator = pageIndicators[page];
  const element = await $(`[data-testid="${indicator}"]`);
  return element.isExisting();
}
