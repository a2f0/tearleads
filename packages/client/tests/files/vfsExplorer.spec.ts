import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage, MINIMAL_PNG } from '../testUtils';

const TEST_PASSWORD = 'testpassword123';
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

test.beforeEach(async ({ page }) => {
  await clearOriginStorage(page);
});

// Helper to navigate using in-app routing (preserves React state)
async function navigateInApp(page: Page, path: string) {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForURL(`**${path}`);
}

// Helper to reset, setup, and unlock the database
async function setupAndUnlockDatabase(page: Page, password = TEST_PASSWORD) {
  await navigateInApp(page, '/sqlite');
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

// Helper to open the VFS Explorer floating window from Home desktop
async function openVfsWindow(page: Page) {
  // Navigate to Home page
  await navigateInApp(page, '/');

  // Double-click the VFS icon to open the floating window
  const vfsIcon = page.locator('button[data-icon-path="/vfs"]');
  await expect(vfsIcon).toBeVisible({ timeout: 10000 });
  await vfsIcon.dblclick();

  // Wait for the floating window to appear
  const vfsWindow = page.locator(
    '[data-testid^="floating-window-vfs"][role="dialog"]'
  );
  await expect(vfsWindow).toBeVisible({ timeout: 10000 });

  return vfsWindow;
}

// Helper to upload a photo (creates an item in the VFS registry)
async function uploadPhoto(page: Page, name = 'test-photo.png') {
  // Navigate to Photos
  await navigateInApp(page, '/photos');

  // Wait for the dropzone to be ready
  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: MINIMAL_PNG
  });

  // Wait for upload to complete
  await expect(page.getByText('1 photo')).toBeVisible({ timeout: 60000 });
}

// Helper to create a folder in VFS Explorer window
async function createFolder(page: Page, folderName: string) {
  // Right-click tree panel empty area below "Unfiled Items"
  const unfiledItems = page.getByText('Unfiled Items').first();
  await expect(unfiledItems).toBeVisible({ timeout: 10000 });
  const box = await unfiledItems.boundingBox();
  if (!box) throw new Error('Cannot get bounding box for Unfiled Items');
  await page.mouse.click(box.x + 50, box.y + 100, { button: 'right' });

  // Click the "New Folder" context action
  const newFolderButton = page
    .locator('div.fixed.inset-0')
    .getByRole('button', { name: 'New Folder' });
  await expect(newFolderButton).toBeVisible({ timeout: 5000 });
  await newFolderButton.click();

  // Fill in the folder name
  const folderNameInput = page.getByTestId('new-folder-name-input');
  await expect(folderNameInput).toBeVisible({ timeout: 5000 });
  await folderNameInput.fill(folderName);

  // Click create button
  await page.getByTestId('new-folder-dialog-create').click();

  // Wait for the folder to appear in the tree panel
  await expect(page.getByText(folderName)).toBeVisible({ timeout: 10000 });
}

test.describe('VFS Explorer linking', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('should link an item to a folder via context menu copy/paste', async ({
    page
  }) => {
    test.slow();

    await page.goto('/');
    await setupAndUnlockDatabase(page);

    // Create a photo to have an item in the VFS
    await uploadPhoto(page);

    // Open VFS Explorer floating window
    await openVfsWindow(page);

    // Navigate to All Items so unfiled uploads are visible.
    await page.getByText('All Items').first().click();

    // Wait for items to load and locate a non-folder row.
    const photoRow = page.locator('tbody tr').first();
    await expect(photoRow).toBeVisible({ timeout: 30000 });

    // Create a folder to link to
    await createFolder(page, 'Test Folder');

    // Right-click on the photo row to open context menu
    await photoRow.click({ button: 'right', force: true });

    // Click "Copy" in the context menu (it's a button, not menuitem)
    const copyButton = page.getByRole('button', { name: 'Copy', exact: true });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    // Navigate to the folder
    const folderButton = page.getByRole('button', {
      name: 'Test Folder',
      exact: true
    });
    await folderButton.click();

    // Verify folder is empty initially
    await expect(page.getByText('This folder is empty')).toBeVisible({
      timeout: 5000
    });

    // Right-click in the empty folder area to open context menu for paste
    const emptyFolderArea = page.getByText('This folder is empty');
    await emptyFolderArea.click({ button: 'right' });

    // Click "Paste" in the context menu
    const pasteButton = page.getByRole('button', { name: 'Paste', exact: true });
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await pasteButton.click();

    // Verify an item now appears in the folder.
    await expect(page.locator('tbody tr').first()).toBeVisible({
      timeout: 10000
    });

    // Verify item count shows 1 item (in the status bar at the bottom)
    await expect(page.locator('text="1 item"').first()).toBeVisible({
      timeout: 5000
    });
  });

});
