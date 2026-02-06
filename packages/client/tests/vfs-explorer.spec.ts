import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { clearOriginStorage, MINIMAL_PNG } from './test-utils';

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
  // Click the "File" menu dropdown
  const fileMenu = page.getByRole('button', { name: 'File', exact: true });
  await expect(fileMenu).toBeVisible({ timeout: 10000 });
  await fileMenu.click();

  // Click the "New Folder" menu item
  const newFolderItem = page.getByRole('menuitem', { name: 'New Folder' });
  await expect(newFolderItem).toBeVisible({ timeout: 5000 });
  await newFolderItem.click();

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

  // Note: dnd-kit drag-and-drop is difficult to test with Playwright's synthetic events.
  // Skipping drag-and-drop tests and using context menu copy/paste instead.
  test.skip('should link an item to a folder via drag and drop', async () => {
    // This test is skipped because Playwright's synthetic pointer events
    // don't properly trigger dnd-kit's PointerSensor.
    // The linking functionality is verified via integration tests and the copy/paste test below.
  });

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

    // Wait for items to load
    await expect(page.getByText('test-photo.png')).toBeVisible({
      timeout: 30000
    });

    // Create a folder to link to
    await createFolder(page, 'Test Folder');

    // Right-click on the photo to open context menu
    const photoRow = page
      .locator('tr')
      .filter({ has: page.getByText('test-photo.png') });
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

    // Verify the photo now appears in the folder
    await expect(page.getByText('test-photo.png')).toBeVisible({
      timeout: 10000
    });

    // Verify item count shows 1 item (in the status bar at the bottom)
    await expect(page.locator('text="1 item"').first()).toBeVisible({
      timeout: 5000
    });
  });

  // Note: dnd-kit drag-and-drop is difficult to test with Playwright's synthetic events.
  // The linking functionality is verified via the copy/paste test above.
  test.skip('should link multiple items to a folder via drag and drop', async ({
    page
  }) => {
    test.slow();

    await page.goto('/');
    await setupAndUnlockDatabase(page);

    // Upload multiple photos
    await navigateInApp(page, '/photos');
    const fileInput = page.getByTestId('dropzone-input');
    await expect(fileInput).toBeAttached({ timeout: 10000 });

    // Upload first photo
    await fileInput.setInputFiles({
      name: 'photo1.png',
      mimeType: 'image/png',
      buffer: MINIMAL_PNG
    });
    await expect(page.getByText('1 photo')).toBeVisible({ timeout: 60000 });

    // Upload second photo
    await fileInput.setInputFiles({
      name: 'photo2.png',
      mimeType: 'image/png',
      buffer: MINIMAL_PNG
    });
    await expect(page.getByText('2 photos')).toBeVisible({ timeout: 60000 });

    // Open VFS Explorer floating window
    await openVfsWindow(page);

    // Wait for items to load
    await expect(page.getByText('photo1.png')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('photo2.png')).toBeVisible({ timeout: 30000 });

    // Create a folder
    await createFolder(page, 'Multi Test Folder');

    // Select first item (force: true because dnd-kit sets aria-disabled on unselected items)
    const photo1Row = page.getByText('photo1.png').first();
    await photo1Row.click({ force: true });

    // Ctrl+click to add second item to selection
    const photo2Row = page.getByText('photo2.png').first();
    await photo2Row.click({ modifiers: ['Control'], force: true });

    // Wait for selection to update
    await page.waitForTimeout(200);

    // Get folder button for drop target
    const folderButton = page.getByRole('button', { name: 'Multi Test Folder' });

    // Drag from first photo to folder
    const sourceBounds = await photo1Row.boundingBox();
    const targetBounds = await folderButton.boundingBox();

    if (sourceBounds && targetBounds) {
      await page.mouse.move(
        sourceBounds.x + sourceBounds.width / 2,
        sourceBounds.y + sourceBounds.height / 2
      );
      await page.mouse.down();

      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const x =
          sourceBounds.x +
          sourceBounds.width / 2 +
          ((targetBounds.x + targetBounds.width / 2 - sourceBounds.x - sourceBounds.width / 2) * i) / steps;
        const y =
          sourceBounds.y +
          sourceBounds.height / 2 +
          ((targetBounds.y + targetBounds.height / 2 - sourceBounds.y - sourceBounds.height / 2) * i) / steps;
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }

      await page.mouse.up();
    }

    // Wait for status message showing both items linked
    await expect(page.getByText(/2 items linked/i)).toBeVisible({
      timeout: 10000
    });

    // Navigate to the folder
    await folderButton.click();
    await page.waitForTimeout(500);

    // Verify both photos appear in the folder
    await expect(page.getByText('photo1.png')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('photo2.png')).toBeVisible({ timeout: 10000 });
  });

  // Note: dnd-kit drag-and-drop is difficult to test with Playwright's synthetic events.
  // The linking functionality is verified via the copy/paste test above.
  test.skip('should show folder contents after creating link', async ({ page }) => {
    test.slow();

    await page.goto('/');
    await setupAndUnlockDatabase(page);

    // Create a photo
    await uploadPhoto(page);

    // Open VFS Explorer floating window
    await openVfsWindow(page);

    // Wait for items to load
    await expect(page.getByText('test-photo.png')).toBeVisible({
      timeout: 30000
    });

    // Create a folder
    await createFolder(page, 'Link Test Folder');
    const folderButton = page.getByRole('button', { name: 'Link Test Folder' });

    // Click on the folder to navigate to it
    await folderButton.click();
    await page.waitForTimeout(300);

    // Verify folder is empty
    await expect(page.getByText('This folder is empty')).toBeVisible({
      timeout: 5000
    });

    // Go back to Unfiled by clicking on "Unfiled" in the tree
    const unfiledButton = page.getByRole('button', { name: 'Unfiled' });
    await unfiledButton.click();
    await page.waitForTimeout(300);

    // Select and drag the photo (force: true because dnd-kit sets aria-disabled on unselected items)
    const photoRow = page.getByText('test-photo.png').first();
    await photoRow.click({ force: true });
    await page.waitForTimeout(200);

    const sourceBounds = await photoRow.boundingBox();
    const targetBounds = await folderButton.boundingBox();

    if (sourceBounds && targetBounds) {
      await page.mouse.move(
        sourceBounds.x + sourceBounds.width / 2,
        sourceBounds.y + sourceBounds.height / 2
      );
      await page.mouse.down();

      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const x =
          sourceBounds.x +
          sourceBounds.width / 2 +
          ((targetBounds.x + targetBounds.width / 2 - sourceBounds.x - sourceBounds.width / 2) * i) / steps;
        const y =
          sourceBounds.y +
          sourceBounds.height / 2 +
          ((targetBounds.y + targetBounds.height / 2 - sourceBounds.y - sourceBounds.height / 2) * i) / steps;
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }

      await page.mouse.up();
    }

    // Wait for link to complete
    await expect(page.getByText(/1 item linked/i)).toBeVisible({
      timeout: 10000
    });

    // Click on folder to view contents
    await folderButton.click();
    await page.waitForTimeout(500);

    // Verify photo is now in the folder (this is the key assertion)
    await expect(page.getByText('test-photo.png')).toBeVisible({
      timeout: 10000
    });

    // Verify item count shows 1 item
    await expect(page.getByText('1 item')).toBeVisible({ timeout: 5000 });
  });
});
