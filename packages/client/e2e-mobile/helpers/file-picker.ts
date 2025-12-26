/**
 * Native file picker and share sheet automation
 *
 * This is the key capability that Maestro cannot provide.
 * Appium can interact with native system dialogs like file pickers and share sheets.
 */

import {
  switchToNativeContext,
  switchToWebViewContext,
} from './webview-helpers.js';
import { getPlatform } from './app-lifecycle.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Push a file to the device for testing file picker selection
 * Returns the path where the file was pushed
 */
export async function pushTestFile(
  localFilePath: string,
  remotePath?: string
): Promise<string> {
  const platform = getPlatform();
  const fileName = path.basename(localFilePath);

  // Read file and convert to base64
  const fileContent = fs.readFileSync(localFilePath);
  const base64Content = fileContent.toString('base64');

  if (platform === 'android') {
    // Push to Downloads folder on Android
    const androidPath = remotePath || `/sdcard/Download/${fileName}`;
    await browser.pushFile(androidPath, base64Content);
    return androidPath;
  } else {
    // iOS: Push to app's Documents directory
    // Note: This requires the app to have the proper entitlements
    const iosPath = remotePath || `@com.tearleads.rapid:documents/${fileName}`;
    await browser.pushFile(iosPath, base64Content);
    return iosPath;
  }
}

/**
 * Handle Android file picker dialog
 */
export async function handleAndroidFilePicker(
  action: 'select' | 'cancel',
  fileName?: string
): Promise<void> {
  await switchToNativeContext();

  if (action === 'cancel') {
    // Wait for any picker element to be present before dismissing
    await browser.waitUntil(
      async () => {
        const contexts = await browser.getContexts();
        return contexts.includes('NATIVE_APP');
      },
      { timeout: 5000, interval: 200 }
    );
    // Android back button to cancel
    await browser.back();
    // switchToWebViewContext has built-in retry logic for context availability
    await switchToWebViewContext();
    return;
  }

  if (action === 'select' && fileName) {
    // Try to navigate to Downloads if we're not already there
    try {
      // Look for the hamburger menu to show roots
      const hamburgerMenu = await $(
        '//android.widget.ImageButton[@content-desc="Show roots"]'
      );
      if (await hamburgerMenu.isExisting()) {
        await hamburgerMenu.click();
        // Wait for navigation drawer to appear
        const downloads = await $('//*[@text="Downloads" or @text="Download"]');
        await downloads.waitForExist({ timeout: 3000 });
      }

      // Click on Downloads
      const downloads = await $('//*[@text="Downloads" or @text="Download"]');
      if (await downloads.isExisting()) {
        await downloads.click();
        // Wait for file list to load
        const fileItem = await $(`//*[contains(@text, "${fileName}")]`);
        await fileItem.waitForExist({ timeout: 5000 });
      }
    } catch {
      // Already in the right location or different picker UI
    }

    // Select the file by name
    const fileItem = await $(`//*[contains(@text, "${fileName}")]`);
    await fileItem.waitForExist({ timeout: 5000 });
    await fileItem.click();
  }

  // switchToWebViewContext has built-in retry logic for context availability
  await switchToWebViewContext();
}

/**
 * Handle iOS file picker dialog (UIDocumentPickerViewController)
 */
export async function handleiOSFilePicker(
  action: 'select' | 'cancel',
  fileName?: string
): Promise<void> {
  await switchToNativeContext();

  // Wait for picker to appear by checking for Cancel button
  const cancelButton = await $('//XCUIElementTypeButton[@name="Cancel"]');
  await cancelButton.waitForExist({ timeout: 5000 });

  if (action === 'cancel') {
    await cancelButton.click();
    // switchToWebViewContext has built-in retry logic for context availability
    await switchToWebViewContext();
    return;
  }

  if (action === 'select' && fileName) {
    // Navigate to Browse if needed
    try {
      const browse = await $('//XCUIElementTypeButton[@name="Browse"]');
      if (await browse.isExisting()) {
        await browse.click();
        // Wait for browse view to appear
        const onMyDevice = await $(
          '//XCUIElementTypeCell[contains(@name, "On My")]'
        );
        await onMyDevice.waitForExist({ timeout: 3000 });
      }
    } catch {
      // Already in browse mode
    }

    // Try to find "On My iPhone" or app's documents
    try {
      const onMyDevice = await $(
        '//XCUIElementTypeCell[contains(@name, "On My")]'
      );
      if (await onMyDevice.isExisting()) {
        await onMyDevice.click();
        // Wait for file list to load
        const fileCell = await $(
          `//XCUIElementTypeCell[contains(@name, "${fileName}")]`
        );
        await fileCell.waitForExist({ timeout: 5000 });
      }
    } catch {
      // Already in the right location
    }

    // Select the file
    const fileCell = await $(
      `//XCUIElementTypeCell[contains(@name, "${fileName}")]`
    );
    await fileCell.waitForExist({ timeout: 5000 });
    await fileCell.click();
  }

  // switchToWebViewContext has built-in retry logic for context availability
  await switchToWebViewContext();
}

/**
 * Handle file picker on current platform
 */
export async function handleFilePicker(
  action: 'select' | 'cancel',
  fileName?: string
): Promise<void> {
  const platform = getPlatform();

  if (platform === 'android') {
    await handleAndroidFilePicker(action, fileName);
  } else {
    await handleiOSFilePicker(action, fileName);
  }
}

/**
 * Handle Android share sheet
 */
export async function handleAndroidShareSheet(
  action: 'save' | 'cancel'
): Promise<void> {
  await switchToNativeContext();

  // Wait for share sheet to appear by looking for any share option
  await browser.waitUntil(
    async () => {
      const shareOption = await $(
        '//*[contains(@text, "Files") or contains(@text, "Save") or contains(@text, "Share")]'
      );
      return shareOption.isExisting();
    },
    { timeout: 5000, interval: 300 }
  );

  if (action === 'cancel') {
    // Tap outside or press back
    await browser.back();
    // switchToWebViewContext has built-in retry logic for context availability
    await switchToWebViewContext();
    return;
  }

  if (action === 'save') {
    // Look for "Save to Files" or "Files" option
    try {
      const saveOption = await $(
        '//*[contains(@text, "Files") or contains(@text, "Save")]'
      );
      if (await saveOption.isExisting()) {
        await saveOption.click();

        // Wait for and confirm save location if prompted
        const saveButton = await $('//*[@text="Save" or @text="SAVE"]');
        try {
          await saveButton.waitForExist({ timeout: 3000 });
          await saveButton.click();
        } catch {
          // No save confirmation needed
        }
      }
    } catch {
      // Share sheet might look different, try to dismiss
      await browser.back();
    }
  }

  // switchToWebViewContext has built-in retry logic for context availability
  await switchToWebViewContext();
}

/**
 * Handle iOS share sheet (UIActivityViewController)
 */
export async function handleiOSShareSheet(
  action: 'save' | 'cancel'
): Promise<void> {
  await switchToNativeContext();

  // Wait for share sheet to appear by checking for Close button
  const closeButton = await $(
    '//XCUIElementTypeButton[@name="Close" or @name="Cancel"]'
  );
  await closeButton.waitForExist({ timeout: 5000 });

  if (action === 'cancel') {
    await closeButton.click();
    // switchToWebViewContext has built-in retry logic for context availability
    await switchToWebViewContext();
    return;
  }

  if (action === 'save') {
    // Find "Save to Files" option
    try {
      const saveToFiles = await $(
        '//XCUIElementTypeCell[@name="Save to Files"]'
      );
      if (await saveToFiles.isExisting()) {
        await saveToFiles.click();

        // Wait for and tap Save button
        const saveButton = await $('//XCUIElementTypeButton[@name="Save"]');
        try {
          await saveButton.waitForExist({ timeout: 3000 });
          await saveButton.click();
        } catch {
          // No save confirmation needed
        }
      }
    } catch {
      // Try to dismiss the share sheet
      if (await closeButton.isExisting()) {
        await closeButton.click();
      }
    }
  }

  // switchToWebViewContext has built-in retry logic for context availability
  await switchToWebViewContext();
}

/**
 * Handle share sheet on current platform
 */
export async function handleShareSheet(action: 'save' | 'cancel'): Promise<void> {
  const platform = getPlatform();

  if (platform === 'android') {
    await handleAndroidShareSheet(action);
  } else {
    await handleiOSShareSheet(action);
  }
}

/**
 * Handle permission dialogs (storage, etc.)
 */
export async function handlePermissionDialog(
  action: 'allow' | 'deny'
): Promise<void> {
  const platform = getPlatform();
  await switchToNativeContext();

  try {
    if (platform === 'android') {
      if (action === 'allow') {
        const allowButton = await $(
          '//*[@text="Allow" or @text="ALLOW" or @resource-id="com.android.permissioncontroller:id/permission_allow_button"]'
        );
        if (await allowButton.isExisting()) {
          await allowButton.click();
        }
      } else {
        const denyButton = await $(
          '//*[@text="Deny" or @text="DENY" or @resource-id="com.android.permissioncontroller:id/permission_deny_button"]'
        );
        if (await denyButton.isExisting()) {
          await denyButton.click();
        }
      }
    } else {
      if (action === 'allow') {
        const allowButton = await $(
          '//XCUIElementTypeButton[@name="Allow" or @name="OK"]'
        );
        if (await allowButton.isExisting()) {
          await allowButton.click();
        }
      } else {
        const denyButton = await $(
          '//XCUIElementTypeButton[@name="Don\'t Allow"]'
        );
        if (await denyButton.isExisting()) {
          await denyButton.click();
        }
      }
    }
  } catch {
    // No permission dialog present
  }

  await switchToWebViewContext();
}

/**
 * Pull a file from the device
 * Returns the file content as a Buffer
 */
export async function pullFile(remotePath: string): Promise<Buffer> {
  const base64Content = await browser.pullFile(remotePath);
  return Buffer.from(base64Content, 'base64');
}

/**
 * Check if a file exists on the device
 */
export async function fileExistsOnDevice(remotePath: string): Promise<boolean> {
  try {
    await browser.pullFile(remotePath);
    return true;
  } catch {
    return false;
  }
}
