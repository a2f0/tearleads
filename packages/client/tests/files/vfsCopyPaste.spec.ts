import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage, MINIMAL_PNG } from '../testUtils';

test.beforeEach(async ({ page }) => {
  await clearOriginStorage(page);
});

// Helper to navigate using in-app routing (preserves React state)
async function navigateInApp(page: Page, path: string) {
  await page.evaluate((route) => {
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(500);
}

// Helper to reset, setup, and unlock the database
async function setupAndUnlockDatabase(
  page: Page,
  password = 'testpassword123'
) {
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

// Helper to upload a file to create a VFS item
async function uploadTestFile(page: Page) {
  // Navigate to Photos page to upload a file
  await navigateInApp(page, '/photos');

  const fileInput = page.getByTestId('dropzone-input');
  await expect(fileInput).toBeAttached({ timeout: 10000 });

  await fileInput.setInputFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: MINIMAL_PNG
  });

  // Wait for photo to appear
  await expect(page.getByText('1 photo')).toBeVisible({ timeout: 60000 });
}

// Helper to navigate to VFS page
async function navigateToVfs(page: Page) {
  await navigateInApp(page, '/vfs');
  // Wait for VFS Explorer to load - look for the Folders header
  await expect(page.getByText('Folders')).toBeVisible({ timeout: 10000 });
  // Also wait for Unfiled Items which indicates tree is loaded
  await expect(page.getByText('Unfiled Items')).toBeVisible({ timeout: 10000 });
}

// Helper to create a folder
async function createFolder(page: Page, folderName: string) {
  // Right-click in the tree panel content area (below Unfiled Items)
  // The tree panel has a scrollable content area with class flex-1 overflow-y-auto
  // We need to right-click in an empty area of that panel
  const unfiledItems = page.getByText('Unfiled Items').first();
  await expect(unfiledItems).toBeVisible({ timeout: 5000 });

  // Get the bounding box and click below it in the same container
  const box = await unfiledItems.boundingBox();
  if (!box) throw new Error('Cannot get bounding box for Unfiled Items');

  // Right-click below the All Items button (in empty space of tree panel)
  await page.mouse.click(box.x + 50, box.y + 100, { button: 'right' });

  // Click "New Folder"
  const newFolderButton = page
    .locator('div.fixed.inset-0')
    .getByRole('button', { name: 'New Folder' });
  await expect(newFolderButton).toBeVisible({ timeout: 5000 });
  await newFolderButton.click();

  // Fill in folder name
  const folderNameInput = page.getByTestId('new-folder-name-input');
  await expect(folderNameInput).toBeVisible({ timeout: 5000 });
  await folderNameInput.fill(folderName);

  // Click create
  await page.getByTestId('new-folder-dialog-create').click();

  // Wait for folder to appear in tree
  await expect(page.getByText(folderName)).toBeVisible({ timeout: 10000 });
}

test.describe('VFS copy/paste', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('should copy item from All Items and paste into folder', async ({
    page
  }) => {
    test.slow(); // File upload and operations can be slow
    await page.goto('/');
    await setupAndUnlockDatabase(page);

    // Upload a test file to create a VFS item
    await uploadTestFile(page);

    // Navigate to VFS
    await navigateToVfs(page);

    // Create a new folder
    await createFolder(page, 'Test Copy Folder');

    // Navigate to All Items
    const allItemsButton = page.getByText('All Items').first();
    await allItemsButton.click();

    // Wait for items to load - find the photo row (not the folder)
    // Folders are sorted first, so we need to find a row with type 'file'
    const photoRow = page.locator('tbody tr', { hasText: 'file' }).first();
    await expect(photoRow).toBeVisible({ timeout: 15000 });

    // Use dispatchEvent to trigger right-click since the row has aria-disabled
    await photoRow.dispatchEvent('contextmenu');

    // Click Copy (use exact match to avoid matching folders with "Copy" in name)
    const copyButton = page.getByRole('button', { name: 'Copy', exact: true });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    // Click on Test Copy Folder to navigate to it
    const testFolderButton = page.getByText('Test Copy Folder').first();
    await testFolderButton.click();

    // Wait for empty folder message
    await expect(page.getByText('This folder is empty')).toBeVisible({
      timeout: 5000
    });

    // Right-click to paste - find the empty folder content area
    const emptyFolderArea = page.getByText('This folder is empty');
    await emptyFolderArea.click({ button: 'right' });

    // Click Paste
    const pasteButton = page.getByRole('button', { name: 'Paste', exact: true });
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await pasteButton.click();

    // Verify empty message is gone and item appears in folder
    await expect(page.getByText('This folder is empty')).not.toBeVisible({
      timeout: 15000
    });
    const pastedItemRow = page.locator('tbody tr').first();
    await expect(pastedItemRow).toBeVisible({ timeout: 15000 });
  });

  test('should copy item from Unfiled Items and paste into folder', async ({
    page
  }) => {
    test.slow();
    await page.goto('/');
    await setupAndUnlockDatabase(page);

    // Upload a test file (goes to Unfiled Items by default)
    await uploadTestFile(page);

    // Navigate to VFS
    await navigateToVfs(page);

    // Create a new folder
    await createFolder(page, 'Unfiled Test Folder');

    // Click on Unfiled Items
    const unfiledButton = page.getByText('Unfiled Items').first();
    await unfiledButton.click();

    // Wait for items to load - check for table rows
    const itemRow = page.locator('tbody tr').first();
    await expect(itemRow).toBeVisible({ timeout: 15000 });
    await itemRow.dispatchEvent('contextmenu');

    // Click Copy (use exact match to avoid matching folders with "Copy" in name)
    const copyButton = page.getByRole('button', { name: 'Copy', exact: true });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    // Navigate to the folder
    await page.getByText('Unfiled Test Folder').first().click();
    await expect(page.getByText('This folder is empty')).toBeVisible({
      timeout: 5000
    });

    // Paste
    const emptyFolderArea = page.getByText('This folder is empty');
    await emptyFolderArea.click({ button: 'right' });

    const pasteButton = page.getByRole('button', { name: 'Paste', exact: true });
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await pasteButton.click();

    // Wait and verify - table should have a row
    const pastedItemRow = page.locator('tbody tr').first();
    await expect(pastedItemRow).toBeVisible({ timeout: 15000 });
  });

  test('should not duplicate item when pasting same item twice', async ({
    page
  }) => {
    test.slow();
    await page.goto('/');
    await setupAndUnlockDatabase(page);

    // Upload a test file
    await uploadTestFile(page);

    // Navigate to VFS
    await navigateToVfs(page);

    // Create a new folder
    await createFolder(page, 'Duplicate Test Folder');

    // Go to All Items
    await page.getByText('All Items').first().click();

    // Copy the photo item (not the folder - folders are sorted first)
    const photoRow = page.locator('tbody tr', { hasText: 'file' }).first();
    await expect(photoRow).toBeVisible({ timeout: 15000 });
    await photoRow.dispatchEvent('contextmenu');

    let copyButton = page.getByRole('button', { name: 'Copy', exact: true });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    // Navigate to folder and paste
    await page.getByText('Duplicate Test Folder').first().click();
    await expect(page.getByText('This folder is empty')).toBeVisible({
      timeout: 5000
    });

    let emptyFolderArea = page.getByText('This folder is empty');
    await emptyFolderArea.click({ button: 'right' });

    let pasteButton = page.getByRole('button', { name: 'Paste', exact: true });
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await pasteButton.click();

    // Verify first paste worked - table should have a row
    const firstPastedRow = page.locator('tbody tr').first();
    await expect(firstPastedRow).toBeVisible({ timeout: 15000 });

    // Go back to All Items and copy again
    await page.getByText('All Items').first().click();

    // Copy the photo again (not the folder)
    const photoRowAgain = page.locator('tbody tr', { hasText: 'file' }).first();
    await expect(photoRowAgain).toBeVisible({ timeout: 15000 });
    await photoRowAgain.dispatchEvent('contextmenu');

    copyButton = page.getByRole('button', { name: 'Copy', exact: true });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    // Navigate to folder and paste again
    await page.getByText('Duplicate Test Folder').first().click();

    // Folder should now show item(s) - first pasted row should be visible
    const existingRow = page.locator('tbody tr').first();
    await expect(existingRow).toBeVisible({ timeout: 15000 });

    // Count rows before second paste
    const rowsBeforePaste = await page.locator('tbody tr').count();

    // Right-click on the content area to get context menu
    const contentArea = page.locator('.flex-1.overflow-y-auto').first();
    await contentArea.click({ button: 'right', position: { x: 200, y: 100 } });

    pasteButton = page.getByRole('button', { name: 'Paste', exact: true });
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await pasteButton.click();

    // Wait briefly for paste operation to complete, then verify count
    await page.waitForTimeout(500);
    const rowsAfterPaste = await page.locator('tbody tr').count();
    expect(rowsAfterPaste).toBe(rowsBeforePaste);
  });
});
