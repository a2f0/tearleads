/**
 * Settings page object for backup/restore and theme interactions
 */

import { BasePage } from './base.page.js';
import { handleFilePicker, handleShareSheet } from '../helpers/file-picker.js';

// Test IDs used on the settings page
const SELECTORS = {
  darkModeSwitch: 'dark-mode-switch',
  backupExportButton: 'backup-export-button',
  dropzoneNative: 'dropzone-native',
  dropzoneInput: 'dropzone-input',
  backupRestoreConfirm: 'backup-restore-confirm',
} as const;

class SettingsPage extends BasePage {
  /**
   * Wait for the settings page to load
   */
  async waitForPageLoad(): Promise<void> {
    await this.waitForElement(SELECTORS.darkModeSwitch);
  }

  // ============= Dark Mode =============

  /**
   * Toggle dark mode switch
   */
  async toggleDarkMode(): Promise<void> {
    await this.clickByTestId(SELECTORS.darkModeSwitch);
  }

  /**
   * Check if dark mode is enabled
   * Uses the aria-checked attribute on the toggle switch which is more reliable
   */
  async isDarkMode(): Promise<boolean> {
    await this.switchToWebView();
    const toggle = await $('[data-testid="dark-mode-switch"]');
    const ariaChecked = await toggle.getAttribute('aria-checked');
    return ariaChecked === 'true';
  }

  /**
   * Enable dark mode if not already enabled
   */
  async enableDarkMode(): Promise<void> {
    if (!(await this.isDarkMode())) {
      await this.toggleDarkMode();
    }
  }

  /**
   * Disable dark mode if enabled
   */
  async disableDarkMode(): Promise<void> {
    if (await this.isDarkMode()) {
      await this.toggleDarkMode();
    }
  }

  // ============= Backup Export =============

  /**
   * Click the export backup button
   */
  async clickExportBackup(): Promise<void> {
    await this.clickByTestId(SELECTORS.backupExportButton);
  }

  /**
   * Check if export button is enabled
   */
  async isExportButtonEnabled(): Promise<boolean> {
    return this.isEnabledByTestId(SELECTORS.backupExportButton);
  }

  /**
   * Export backup and handle the share sheet
   * @param saveToFiles - If true, saves the file; if false, cancels the share sheet
   */
  async exportBackup(saveToFiles = true): Promise<void> {
    await this.clickExportBackup();
    await handleShareSheet(saveToFiles ? 'save' : 'cancel');
  }

  // ============= Backup Restore =============

  /**
   * Check if restore dropzone is displayed
   */
  async isRestoreDropzoneDisplayed(): Promise<boolean> {
    return this.isDisplayedByTestId(SELECTORS.dropzoneNative);
  }

  /**
   * Click the Choose Files button to open file picker
   */
  async clickChooseFiles(): Promise<void> {
    // Click the native dropzone which triggers file picker
    await this.clickByTestId(SELECTORS.dropzoneNative);
  }

  /**
   * Select a file for restore using the native file picker
   * @param fileName - The name of the file to select
   */
  async selectRestoreFile(fileName: string): Promise<void> {
    await this.clickChooseFiles();
    await handleFilePicker('select', fileName);
  }

  /**
   * Cancel the file picker without selecting a file
   */
  async cancelFilePicker(): Promise<void> {
    await this.clickChooseFiles();
    await handleFilePicker('cancel');
  }

  /**
   * Click confirm restore button
   */
  async clickConfirmRestore(): Promise<void> {
    await this.clickByTestId(SELECTORS.backupRestoreConfirm);
  }

  /**
   * Check if confirm restore button exists and is displayed
   */
  async isConfirmRestoreDisplayed(): Promise<boolean> {
    return this.isDisplayedByTestId(SELECTORS.backupRestoreConfirm);
  }

  /**
   * Full restore workflow: select file and confirm
   */
  async restoreFromFile(fileName: string): Promise<void> {
    await this.selectRestoreFile(fileName);
    // Wait for the confirm button to appear after file selection
    await this.waitForElement(SELECTORS.backupRestoreConfirm);
    await this.clickConfirmRestore();
  }
}

export const settingsPage = new SettingsPage();
