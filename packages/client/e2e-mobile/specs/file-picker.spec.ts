/**
 * File Picker test - verifies native file picker functionality
 * Ported from: .maestro/file-picker.yaml
 *
 * This demonstrates Appium's key advantage over Maestro:
 * the ability to interact with native system file pickers.
 */

import { launchAppWithClearState } from '../helpers/app-lifecycle.js';
import { switchToWebViewContext, waitForWebView } from '../helpers/webview-helpers.js';
import { handleFilePicker } from '../helpers/file-picker.js';

describe('File Picker', () => {
  before(async () => {
    await launchAppWithClearState();
    await waitForWebView();
  });

  describe('Dropzone on native', () => {
    it('should display "Choose Files" button', async () => {
      await switchToWebViewContext();

      // On native, the dropzone should show the "Choose Files" button
      const chooseFilesButton = await $('[data-testid="dropzone-native"]');
      await expect(chooseFilesButton).toBeDisplayed();

      // Also verify the button text contains "Choose Files"
      const buttonText = await chooseFilesButton.getText();
      expect(buttonText.toLowerCase()).toContain('choose');
    });

    it('should NOT display "Drag and drop" text on native', async () => {
      await switchToWebViewContext();

      // Native uses button instead of drag-and-drop
      // The dropzone-web element should not be visible
      const dropzoneWeb = await $('[data-testid="dropzone-web"]');
      const isDisplayed = await dropzoneWeb.isDisplayed().catch(() => false);
      expect(isDisplayed).toBe(false);
    });
  });

  describe('Native file picker interaction', () => {
    /**
     * This is the key capability that Maestro cannot provide.
     * Appium can actually open and interact with the native file picker.
     */

    it('should open native file picker when button is clicked', async () => {
      await switchToWebViewContext();

      // Click the Choose Files button
      const chooseFilesButton = await $('[data-testid="dropzone-native"]');
      await chooseFilesButton.click();

      // Wait a moment for the file picker to appear
      await browser.pause(1000);

      // Cancel the file picker to return to the app
      await handleFilePicker('cancel');

      // Verify we're back in the app
      await switchToWebViewContext();
      const title = await $('*=Tearleads');
      await expect(title).toBeDisplayed();
    });

    it('should be able to cancel file picker without errors', async () => {
      await switchToWebViewContext();

      // Open file picker again
      const chooseFilesButton = await $('[data-testid="dropzone-native"]');
      await chooseFilesButton.click();

      await browser.pause(1000);

      // Cancel again
      await handleFilePicker('cancel');

      // App should still be functional
      await switchToWebViewContext();
      const chooseFilesAgain = await $('[data-testid="dropzone-native"]');
      await expect(chooseFilesAgain).toBeDisplayed();
    });
  });
});
