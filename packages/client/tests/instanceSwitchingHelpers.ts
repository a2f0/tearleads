import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { MINIMAL_PNG } from './testUtils';

export const TEST_PASSWORD = 'testpassword123';
export const DB_OPERATION_TIMEOUT = 15000;

// Helper to check if viewport is mobile (sidebar hidden at lg breakpoint = 1024px)
const isMobileViewport = (page: Page): boolean => {
  const viewport = page.viewportSize();
  return (viewport?.width ?? 0) < 1024;
};

// Map page names to routes
const PAGE_ROUTES = {
  SQLite: '/sqlite',
  Files: '/files'
} as const;

// Helper for in-app navigation that preserves React state (including current instance)
// Uses history.pushState + popstate event to trigger React Router navigation
// without a full page reload. This is critical for instance switching tests
// because page.goto() causes initializeRegistry() to reset to test-worker-N instance.
const navigateInApp = async (page: Page, path: string): Promise<void> => {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  // Give React time to process the navigation
  await page.waitForTimeout(500);
};

// Helper to unlock via inline unlock component if database is locked after page navigation
export const unlockIfNeeded = async (page: Page, password = TEST_PASSWORD): Promise<void> => {
  // Wait for page to stabilize after navigation
  await page.waitForTimeout(500);

  const inlineUnlock = page.getByTestId('inline-unlock-password');
  if (await inlineUnlock.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inlineUnlock.fill(password);
    await page.getByTestId('inline-unlock-button').click();
    await expect(inlineUnlock).not.toBeVisible({ timeout: DB_OPERATION_TIMEOUT });
  }
};

// Helper to navigate to a page, handling mobile/desktop differences
export const navigateToPage = async (page: Page, pageName: 'SQLite' | 'Files') => {
  const isMobile = isMobileViewport(page);

  if (isMobile) {
    await page.getByTestId('mobile-menu-button').click();
    await page
      .getByTestId('mobile-menu-dropdown')
      .getByTestId(`${pageName.toLowerCase()}-link`)
      .click();
  } else {
    // Use in-app navigation to preserve React state (including current instance)
    // page.goto() would cause a full reload, resetting instance to test-worker-N
    const route = PAGE_ROUTES[pageName];
    await navigateInApp(page, route);
    await unlockIfNeeded(page);
  }
};

// Helper to upload a test file and wait for it to appear in the list
export const uploadTestFile = async (page: Page, fileName = 'test-image.png') => {
  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: MINIMAL_PNG
  });

  // Wait for "1 file" text which confirms the upload completed
  await expect(page.getByText('1 file')).toBeVisible({ timeout: 60000 });
};

// Helper to setup database on the SQLite page (handles locked/unlocked states)
export const setupDatabaseOnSqlitePage = async (
  page: Page,
  useInAppNavigation = false
) => {
  if (useInAppNavigation) {
    // Use in-app navigation by directly modifying the URL hash/path
    // This preserves React state including the current instance
    await page.evaluate(() => {
      window.history.pushState({}, '', '/sqlite');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(500);
  } else {
    await navigateToPage(page, 'SQLite');
  }

  // Wait for status to stabilize (not Loading)
  await expect(page.getByTestId('db-status')).not.toHaveText('Loading...', {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Check the current database status
  const status = await page.getByTestId('db-status').textContent();

  if (status === 'Unlocked') {
    // Already unlocked, nothing to do
    return;
  }

  if (status === 'Locked') {
    // Database is locked, reset it first to get to "Not Set Up" state
    await page.getByTestId('db-reset-button').click();
    await expect(page.getByTestId('db-test-result')).toHaveAttribute(
      'data-status',
      'success',
      { timeout: DB_OPERATION_TIMEOUT }
    );
    await expect(page.getByTestId('db-status')).toHaveText('Not Set Up', {
      timeout: DB_OPERATION_TIMEOUT
    });
  }

  // Now set up the database
  await page.getByTestId('db-password-input').fill(TEST_PASSWORD);
  await page.getByTestId('db-setup-button').click();

  // Wait for the operation to complete (either success or error)
  const resultElement = page.getByTestId('db-test-result');
  await expect(resultElement).toHaveAttribute('data-status', /(success|error)/, {
    timeout: DB_OPERATION_TIMEOUT
  });

  // Check if it was an error
  const resultStatus = await resultElement.getAttribute('data-status');
  if (resultStatus === 'error') {
    const errorText = await resultElement.textContent();
    throw new Error(`Database setup failed: ${errorText}`);
  }

  // Verify the database is now unlocked
  await expect(page.getByTestId('db-status')).toHaveText('Unlocked', {
    timeout: DB_OPERATION_TIMEOUT
  });
};

// Helper to create a new instance while on any page
export const createNewInstanceFromAnyPage = async (page: Page) => {
  await page.getByTestId('account-switcher-button').click();
  await expect(page.getByTestId('create-instance-button')).toBeVisible();
  await page.getByTestId('create-instance-button').click();

  // Wait for instance creation and OPFS registry write to complete
  // This is important because page.goto() will reload and read the registry
  await page.waitForTimeout(1000);
};

// Helper to switch to instance while on any page
export const switchToInstanceFromAnyPage = async (
  page: Page,
  instanceIndex: number
) => {
  await page.getByTestId('account-switcher-button').click();
  const instanceItems = page.locator(
    '[data-testid^="instance-"]:not([data-testid*="unlocked"]):not([data-testid*="locked"]):not([data-testid*="delete"])'
  );
  await expect(instanceItems.nth(instanceIndex)).toBeVisible();
  await instanceItems.nth(instanceIndex).click();

  // Wait for the account switcher dropdown to close (indicates click was handled)
  await expect(page.getByTestId('create-instance-button')).not.toBeVisible();

  // Wait for the instance switch to complete (loading state to settle)
  await page.waitForTimeout(500);
};
