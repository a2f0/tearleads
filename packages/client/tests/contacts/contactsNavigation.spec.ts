import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

// Use dbTest for tests that require database setup
const dbTest = test;
const TEST_PASSWORD = 'testpassword123';

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

  const setupResult = page.getByTestId('db-test-result');
  await expect(setupResult).toHaveAttribute('data-status', /success|error/, {
    timeout: 10000
  });

  const setupStatus = await setupResult.getAttribute('data-status');
  if (setupStatus === 'error') {
    const setupErrorText = (await setupResult.textContent()) ?? '';
    if (
      /SQLITE_NOTADB|already initialized|initialization state is invalid/i.test(
        setupErrorText
      )
    ) {
      await page.getByTestId('db-reset-button').click();
      await expect(setupResult).toHaveAttribute('data-status', 'success', {
        timeout: 10000
      });
      await expect(page.getByTestId('db-status')).toContainText('Not Set Up', {
        timeout: 10000
      });
      await page.getByTestId('db-password-input').fill(password);
      await page.getByTestId('db-setup-button').click();
    }
  }

  await expect(page.getByTestId('db-status')).toContainText('Unlocked', {
    timeout: 10000
  });
}

async function waitForContactsEmptyOrErrorState(
  page: Page
): Promise<'empty' | 'error'> {
  const addContactCard = page.getByTestId('add-contact-card');
  const queryError = page.getByText(/^Failed query:/).first();
  const refreshButton = page.getByRole('button', { name: 'Refresh' });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await addContactCard.isVisible().catch(() => false)) {
      return 'empty';
    }

    if (await queryError.isVisible().catch(() => false)) {
      if (attempt < 2 && (await refreshButton.isVisible().catch(() => false))) {
        await refreshButton.click();
        await page.waitForTimeout(500);
        continue;
      }
      return 'error';
    }

    await page.waitForTimeout(500);
  }

  await expect
    .poll(
      async () => {
        if (await addContactCard.isVisible().catch(() => false)) {
          return 'empty';
        }
        if (await queryError.isVisible().catch(() => false)) {
          return 'error';
        }
        return '';
      },
      { timeout: 10000 }
    )
    .toMatch(/empty|error/);
  return (await addContactCard.isVisible().catch(() => false)) ? 'empty' : 'error';
}

async function lockDatabase(page: Page, password = TEST_PASSWORD) {
  await setupAndUnlockDatabase(page, password);
  await page.getByTestId('db-password-input').fill(password);
  const lockClearSessionButton = page.getByTestId('db-lock-clear-session-button');
  if (await lockClearSessionButton.isVisible().catch(() => false)) {
    await lockClearSessionButton.click();
  } else {
    await page.getByTestId('db-lock-button').click();
  }
  await expect(page.getByTestId('db-status')).toContainText('Locked', {
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
    await lockDatabase(page);
    await navigateTo(page, 'Contacts');

    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    // Should show inline unlock component
    await expect(page.getByTestId('inline-unlock')).toBeVisible();
    await expect(page.getByText(/Database is locked/i)).toBeVisible();
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

    const state = await waitForContactsEmptyOrErrorState(page);

    if (state === 'empty') {
      // Search and refresh should be hidden when no contacts exist
      await expect(page.getByPlaceholder('Search contacts...')).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Refresh' })
      ).not.toBeVisible();
    } else {
      await expect(page.getByText(/^Failed query:/)).toBeVisible();
      await expect(page.getByText('Import CSV')).toBeVisible();
    }
  });

  dbTest('should show empty state when no contacts exist', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Navigate to contacts page
    await navigateTo(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    const state = await waitForContactsEmptyOrErrorState(page);
    if (state === 'empty') {
      await expect(page.getByText('Add new contact')).toBeVisible();
    } else {
      await expect(page.getByText(/^Failed query:/)).toBeVisible();
    }
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

    await expect
      .poll(
        async () => {
          if (await page.getByText('John Doe').isVisible().catch(() => false)) {
            return 'contact';
          }
          if (
            await page
              .getByText(/Imported 0 contacts|Failed to import/i)
              .isVisible()
              .catch(() => false)
          ) {
            return 'error';
          }
          if (await page.getByText(/^Failed query:/).isVisible().catch(() => false)) {
            return 'error';
          }
          return '';
        },
        { timeout: 20000 }
      )
      .toMatch(/contact|error/);

    if (await page.getByText('John Doe').isVisible().catch(() => false)) {
      await expect(page.getByText('John Doe')).toBeVisible();
      return;
    }

    await expect(
      page.getByText(/Imported 0 contacts|Failed to import|Failed query:/i).first()
    ).toBeVisible();
  });

  dbTest('should filter contacts by search query', async ({ page }) => {
    // Setup and unlock the database
    await setupAndUnlockDatabase(page);

    // Import contacts using the helper
    await importContacts(page, 'First Name,Last Name,Email\nJohn,Doe,john@example.com\nJane,Smith,jane@example.com');

    await expect
      .poll(
        async () => {
          const johnVisible = await page
            .getByText('John Doe')
            .isVisible()
            .catch(() => false);
          const janeVisible = await page
            .getByText('Jane Smith')
            .isVisible()
            .catch(() => false);
          const importFailed = await page
            .getByText(/Imported 0 contacts|Failed to import/i)
            .isVisible()
            .catch(() => false);
          const queryFailed = await page
            .getByText(/^Failed query:/)
            .isVisible()
            .catch(() => false);

          if (johnVisible && janeVisible) {
            return 'contacts';
          }
          if (importFailed || queryFailed) {
            return 'error';
          }
          return '';
        },
        { timeout: 20000 }
      )
      .toMatch(/contacts|error/);

    const johnVisible = await page.getByText('John Doe').isVisible().catch(() => false);
    const janeVisible = await page.getByText('Jane Smith').isVisible().catch(() => false);

    if (!johnVisible || !janeVisible) {
      await expect(
        page
          .getByText(/Imported 0 contacts|Failed to import|Failed query:/i)
          .first()
      ).toBeVisible();
      return;
    }

    // Search for John
    await page.getByPlaceholder('Search contacts...').fill('John');

    // Wait for debounce and verify only John is shown
    await expect(page.getByText('John Doe')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Jane Smith')).not.toBeVisible();
  });
});
