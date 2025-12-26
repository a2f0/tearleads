/**
 * Tables page object for SQLite table viewer interactions
 */

import { BasePage } from './base.page.js';

class TablesPage extends BasePage {
  /**
   * Wait for the tables page to load
   */
  async waitForPageLoad(): Promise<void> {
    // Wait for either the tables list or the locked message
    await this.switchToWebView();
    await browser.waitUntil(
      async () => {
        const lockedMsg = await $('[data-testid="tables-locked-message"]');
        const tableItem = await $('[data-testid^="table-name-"]');
        return (
          (await lockedMsg.isExisting()) || (await tableItem.isExisting())
        );
      },
      { timeout: 10000, timeoutMsg: 'Tables page did not load' }
    );
  }

  /**
   * Check if the locked message is displayed
   */
  async isLockedMessageDisplayed(): Promise<boolean> {
    await this.switchToWebView();
    try {
      const element = await $('[data-testid="tables-locked-message"]');
      return element.isExisting();
    } catch {
      return false;
    }
  }

  /**
   * Get list of table names displayed
   */
  async getTableNames(): Promise<string[]> {
    await this.switchToWebView();
    const tables: string[] = [];

    // Look for table name elements
    const tableElements = await $$('[data-testid^="table-name-"]');
    for (const element of tableElements) {
      const name = await element.getText();
      tables.push(name);
    }

    return tables;
  }

  /**
   * Check if a specific table is displayed
   */
  async hasTable(tableName: string): Promise<boolean> {
    const tables = await this.getTableNames();
    return tables.includes(tableName);
  }

  /**
   * Check if user_settings table exists
   */
  async hasUserSettingsTable(): Promise<boolean> {
    return this.hasTable('user_settings');
  }

  /**
   * Check if schema_migrations table exists
   */
  async hasSchemaMigrationsTable(): Promise<boolean> {
    return this.hasTable('schema_migrations');
  }

  /**
   * Get row count for a specific table
   */
  async getTableRowCount(tableName: string): Promise<number | null> {
    await this.switchToWebView();
    try {
      const countElement = await $(`[data-testid="table-count-${tableName}"]`);
      if (!(await countElement.isExisting())) return null;
      const text = await countElement.getText();
      const match = text.match(/\d+/);
      return match ? parseInt(match[0], 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Click refresh button
   */
  async clickRefresh(): Promise<void> {
    await this.clickByTestId('tables-refresh-button');
  }

  /**
   * Wait for tables to be displayed (database is unlocked)
   */
  async waitForTables(timeout = 10000): Promise<void> {
    await this.switchToWebView();
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const isLocked = await this.isLockedMessageDisplayed();
      if (!isLocked) {
        const tables = await this.getTableNames();
        if (tables.length > 0) {
          return;
        }
      }
      await browser.pause(500);
    }

    throw new Error('Tables not displayed within timeout');
  }
}

export const tablesPage = new TablesPage();
