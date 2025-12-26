/**
 * Debug page object for database test interactions
 */

import { BasePage } from './base.page.js';
import { waitForStatus, waitForResult } from '../helpers/wait-helpers.js';

// Test IDs used on the debug page
const SELECTORS = {
  databaseTest: 'database-test',
  dbStatus: 'db-status',
  dbPasswordInput: 'db-password-input',
  dbSetupButton: 'db-setup-button',
  dbUnlockButton: 'db-unlock-button',
  dbLockButton: 'db-lock-button',
  dbResetButton: 'db-reset-button',
  dbWriteButton: 'db-write-button',
  dbReadButton: 'db-read-button',
  dbTestResult: 'db-test-result',
  dbTestData: 'db-test-data',
} as const;

export type DbStatus = 'Not Set Up' | 'Locked' | 'Unlocked';

class DebugPage extends BasePage {
  /**
   * Wait for the debug page to fully load
   */
  async waitForPageLoad(): Promise<void> {
    await this.waitForElement(SELECTORS.databaseTest);
  }

  /**
   * Get current database status
   */
  async getStatus(): Promise<string> {
    return this.getTextByTestId(SELECTORS.dbStatus);
  }

  /**
   * Set password in the password input
   */
  async setPassword(password: string): Promise<void> {
    await this.fillByTestId(SELECTORS.dbPasswordInput, password);
  }

  /**
   * Clear password input
   */
  async clearPassword(): Promise<void> {
    const element = await this.waitForElement(SELECTORS.dbPasswordInput);
    await element.clearValue();
  }

  /**
   * Click the Setup button
   */
  async clickSetup(): Promise<void> {
    await this.clickByTestId(SELECTORS.dbSetupButton);
  }

  /**
   * Click the Unlock button
   */
  async clickUnlock(): Promise<void> {
    await this.clickByTestId(SELECTORS.dbUnlockButton);
  }

  /**
   * Click the Lock button
   */
  async clickLock(): Promise<void> {
    await this.clickByTestId(SELECTORS.dbLockButton);
  }

  /**
   * Click the Reset button
   */
  async clickReset(): Promise<void> {
    const element = await this.waitForElement(SELECTORS.dbResetButton);
    // Scroll into view before clicking
    await element.scrollIntoView();
    await browser.pause(200);
    await element.click();
  }

  /**
   * Click the Write button
   */
  async clickWriteData(): Promise<void> {
    await this.clickByTestId(SELECTORS.dbWriteButton);
  }

  /**
   * Click the Read button
   */
  async clickReadData(): Promise<void> {
    await this.clickByTestId(SELECTORS.dbReadButton);
  }

  /**
   * Get the test data value displayed
   */
  async getTestData(): Promise<string | null> {
    try {
      return await this.getTextByTestId(SELECTORS.dbTestData);
    } catch {
      return null;
    }
  }

  /**
   * Get the test result status attribute
   */
  async getResultStatus(): Promise<string | null> {
    return this.getAttributeByTestId(SELECTORS.dbTestResult, 'data-status');
  }

  /**
   * Get the test result text
   */
  async getResultText(): Promise<string> {
    return this.getTextByTestId(SELECTORS.dbTestResult);
  }

  /**
   * Wait for success result
   */
  async waitForSuccess(textMatch?: string): Promise<void> {
    await waitForResult('success', textMatch);
  }

  /**
   * Wait for error result
   */
  async waitForError(textMatch?: string): Promise<void> {
    await waitForResult('error', textMatch);
  }

  /**
   * Wait for specific database status
   */
  async waitForStatus(status: DbStatus): Promise<void> {
    await waitForStatus(status);
  }

  /**
   * Check if password is visible (type="text") or hidden (type="password")
   */
  async isPasswordVisible(): Promise<boolean> {
    const type = await this.getAttributeByTestId(
      SELECTORS.dbPasswordInput,
      'type'
    );
    return type === 'text';
  }

  /**
   * Toggle password visibility
   */
  async togglePasswordVisibility(): Promise<void> {
    const isVisible = await this.isPasswordVisible();
    const ariaLabel = isVisible ? 'Hide password' : 'Show password';

    await this.switchToWebView();
    const button = await $(`[aria-label="${ariaLabel}"]`);
    await button.click();
  }

  // ============= Workflow Methods =============

  /**
   * Setup database with password and wait for success
   */
  async setupDatabase(password: string): Promise<void> {
    await this.setPassword(password);
    await this.clickSetup();
    await this.waitForSuccess();
    await this.waitForStatus('Unlocked');
  }

  /**
   * Unlock database with password and wait for success
   */
  async unlockDatabase(password: string): Promise<void> {
    await this.setPassword(password);
    await this.clickUnlock();
    await this.waitForStatus('Unlocked');
  }

  /**
   * Lock database and wait for status change
   */
  async lockDatabase(): Promise<void> {
    await this.clickLock();
    await this.waitForStatus('Locked');
  }

  /**
   * Reset database and wait for status change
   */
  async resetDatabase(): Promise<void> {
    await this.clickReset();
    await this.waitForSuccess();
    await this.waitForStatus('Not Set Up');
  }

  /**
   * Reset database and set up with a new password
   */
  async resetAndSetup(password: string): Promise<void> {
    await this.resetDatabase();
    await this.setupDatabase(password);
  }

  /**
   * Write test data and return the written value
   */
  async writeAndGetData(): Promise<string> {
    await this.clickWriteData();
    await this.waitForSuccess('Wrote test data:');
    const data = await this.getTestData();
    if (!data) throw new Error('Failed to get written test data');
    return data;
  }

  /**
   * Read test data and return the value
   */
  async readAndGetData(): Promise<string> {
    await this.clickReadData();
    await this.waitForSuccess('Read test data:');
    const data = await this.getTestData();
    if (!data) throw new Error('Failed to get read test data');
    return data;
  }
}

export const debugPage = new DebugPage();
