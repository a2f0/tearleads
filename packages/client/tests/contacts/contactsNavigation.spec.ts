import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

// Use dbTest for tests that require database setup
const dbTest = test;

// Helper to open sidebar via Start button
async function openSidebar(page: Page) {
  const startButton = page.getByTestId('start-button');
  await expect(startButton).toBeVisible({ timeout: 10000 });
  if ((await startButton.getAttribute('aria-pressed')) !== 'true') {
    await startButton.click();
  }
  await expect(page.locator('aside nav')).toBeVisible({ timeout: 10000 });
}

async function isDesktopDevice(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const isMobile = window.matchMedia('(max-width: 1023px)').matches;
    const isTouch =
      window.matchMedia('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0;
    return !isMobile && !isTouch;
  });
}

async function navigateWithHistory(page: Page, path: string): Promise<void> {
  await page.evaluate((targetPath) => {
    window.history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function triggerSidebarNavigation(
  _page: Page,
  button: Locator
): Promise<void> {
  await button.click();
}

// All paths that open as floating windows on desktop (matches Sidebar WINDOW_PATHS)
const WINDOW_LAUNCH_PATHS = new Set([
  '/admin/postgres',
  '/admin/redis',
  '/analytics',
  '/audio',
  '/cache-storage',
  '/ai',
  '/console',
  '/contacts',
  '/debug',
  '/docs',
  '/documents',
  '/email',
  '/files',
  '/keychain',
  '/local-storage',
  '/models',
  '/notes',
  '/opfs',
  '/photos',
  '/settings',
  '/sqlite',
  '/sqlite/tables',
  '/videos'
]);

const PATH_OVERRIDES: Record<string, string> = {
  '/postgres-admin': '/admin/postgres',
  '/tables': '/sqlite/tables'
};

const URL_NAVIGATION_PATHS = new Set<string>([]);

async function navigateTo(page: Page, linkName: string) {
  const slug = linkName.toLowerCase().replace(/\s+/g, '-');
  const slugPath = linkName === 'Home' ? '/' : `/${slug}`;
  const path = PATH_OVERRIDES[slugPath] ?? slugPath;
  const isDesktop = await isDesktopDevice(page);

  if (isDesktop && (WINDOW_LAUNCH_PATHS.has(path) || URL_NAVIGATION_PATHS.has(path))) {
    await navigateWithHistory(page, path);
    return;
  }
  const sidebar = page.locator('aside nav');
  const startButton = page.getByTestId('start-button');
  const isSidebarOpen =
    (await startButton.getAttribute('aria-pressed')) === 'true';
  if (!isSidebarOpen) {
    await openSidebar(page);
  } else {
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  }
  const testId = `${slug}-link`;
  const button = sidebar.getByTestId(testId);
  await triggerSidebarNavigation(page, button);
  await expect(sidebar).not.toBeVisible({ timeout: 5000 });
}

// Helper to reset, setup, and unlock the database
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

// Helper to import contacts from a CSV file
async function importContacts(page: Page, csvContent: string) {
  await navigateTo(page, 'Contacts');
  await expect(page.getByText('Import CSV')).toBeVisible({ timeout: 10000 });

  const fileInput = page.getByTestId('dropzone-input');
  await fileInput.setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvContent)
  });

  await expect(page.getByText('Map CSV Columns')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Import' }).click();
}

test.describe('Contacts page', () => {
  // Timeout for waiting for contacts list to refresh after import
  const CONTACT_REFRESH_TIMEOUT = 5000;

  test.beforeEach(async ({ page }) => {
    await clearOriginStorage(page);
    await page.goto('/');
  });

  test('should display contacts page', async ({
    page
  }) => {
    await navigateTo(page, 'Contacts');

    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
  });

  test('should show inline unlock when database is not unlocked', async ({
    page
  }) => {
    await navigateTo(page, 'Contacts');

    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    // Database may be "not set up" (never initialized) or "locked" (set up but not unlocked)
    await expect(
      page.getByText(/Database is (locked|not set up)/)
    ).toBeVisible();
  });

  dbTest('should show import CSV section when database is unlocked', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    // Should show Import CSV section
    await expect(page.getByText('Import CSV')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });

  dbTest('should hide search and refresh when no contacts exist', async ({
    page
  }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    // Wait for empty state to be visible
    await expect(page.getByTestId('add-contact-card')).toBeVisible({
      timeout: 10000
    });

    // Search and refresh should be hidden when no contacts exist
    await expect(page.getByPlaceholder('Search contacts...')).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Refresh' })
    ).not.toBeVisible();
  });

  dbTest('should show empty state when no contacts exist', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    // Should show add contact card when empty
    await expect(page.getByTestId('add-contact-card')).toBeVisible({
      timeout: 10000
    });
    await expect(page.getByText('Add new contact')).toBeVisible();
  });

  dbTest('should show column mapper when CSV is uploaded', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByText('Import CSV')).toBeVisible({ timeout: 10000 });

    // Upload a CSV file
    const fileInput = page.getByTestId('dropzone-input');
    const csvContent = 'First Name,Last Name,Email\nJohn,Doe,john@example.com\nJane,Smith,jane@example.com';
    await fileInput.setInputFiles({
      name: 'contacts.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent)
    });

    // Should show column mapper
    await expect(page.getByText('Map CSV Columns')).toBeVisible({ timeout: 5000 });
  });

  dbTest('should import contacts from CSV and display them', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Import a contact using the helper
    await importContacts(page, 'First Name,Last Name,Email\nJohn,Doe,john@example.com');

    // Should show import result and contact
    await expect(page.getByText(/Imported 1 contact/)).toBeVisible({ timeout: 10000 });
    // Wait for contacts list to refresh after import
    await expect(page.getByText('John Doe')).toBeVisible({ timeout: CONTACT_REFRESH_TIMEOUT });
  });

  dbTest('should filter contacts by search query', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Import contacts using the helper
    await importContacts(page, 'First Name,Last Name,Email\nJohn,Doe,john@example.com\nJane,Smith,jane@example.com');
    await expect(page.getByText(/Imported 2 contacts/)).toBeVisible({ timeout: 10000 });

    // Wait for contacts list to refresh after import
    await expect(page.getByText('John Doe')).toBeVisible({ timeout: CONTACT_REFRESH_TIMEOUT });
    await expect(page.getByText('Jane Smith')).toBeVisible({ timeout: CONTACT_REFRESH_TIMEOUT });

    // Search for John
    await page.getByPlaceholder('Search contacts...').fill('John');

    // Wait for debounce and verify only John is shown
    await expect(page.getByText('John Doe')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Jane Smith')).not.toBeVisible();
  });
});
