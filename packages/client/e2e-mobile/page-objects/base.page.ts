/**
 * Base page object with common WebView interaction patterns
 */

import {
  switchToWebViewContext,
  switchToNativeContext,
} from '../helpers/webview-helpers.js';

export class BasePage {
  /**
   * Wait for an element by test ID to exist
   */
  protected async waitForElement(
    testId: string,
    timeout = 10000
  ): Promise<WebdriverIO.Element> {
    await switchToWebViewContext();
    const element = await $(`[data-testid="${testId}"]`);
    await element.waitForExist({ timeout });
    return element;
  }

  /**
   * Get element by test ID
   */
  protected async getByTestId(testId: string): Promise<WebdriverIO.Element> {
    await switchToWebViewContext();
    return $(`[data-testid="${testId}"]`);
  }

  /**
   * Click element by test ID
   */
  protected async clickByTestId(testId: string): Promise<void> {
    const element = await this.waitForElement(testId);
    await element.click();
  }

  /**
   * Fill input by test ID
   */
  protected async fillByTestId(testId: string, value: string): Promise<void> {
    const element = await this.waitForElement(testId);
    await element.setValue(value);
  }

  /**
   * Get text content by test ID
   */
  protected async getTextByTestId(testId: string): Promise<string> {
    const element = await this.waitForElement(testId);
    return element.getText();
  }

  /**
   * Check if element exists by test ID
   */
  protected async existsByTestId(testId: string): Promise<boolean> {
    await switchToWebViewContext();
    const element = await $(`[data-testid="${testId}"]`);
    return element.isExisting();
  }

  /**
   * Check if element is displayed by test ID
   */
  protected async isDisplayedByTestId(testId: string): Promise<boolean> {
    await switchToWebViewContext();
    const element = await $(`[data-testid="${testId}"]`);
    if (!(await element.isExisting())) return false;
    return element.isDisplayed();
  }

  /**
   * Check if element is enabled by test ID
   */
  protected async isEnabledByTestId(testId: string): Promise<boolean> {
    await switchToWebViewContext();
    const element = await $(`[data-testid="${testId}"]`);
    if (!(await element.isExisting())) return false;
    return element.isEnabled();
  }

  /**
   * Get attribute value by test ID
   */
  protected async getAttributeByTestId(
    testId: string,
    attribute: string
  ): Promise<string | null> {
    const element = await this.waitForElement(testId);
    return element.getAttribute(attribute);
  }

  /**
   * Execute JavaScript in the WebView context
   * Note: Scripts should use 'return' for proper value retrieval
   */
  protected async executeInWebView<T>(script: string): Promise<T> {
    await switchToWebViewContext();
    // Wrap script in a function if it starts with 'return'
    const wrappedScript = script.trimStart().startsWith('return')
      ? `(function() { ${script} })()`
      : script;
    return browser.execute(wrappedScript) as Promise<T>;
  }

  /**
   * Switch to native context for interacting with system dialogs
   */
  protected async switchToNative(): Promise<void> {
    await switchToNativeContext();
  }

  /**
   * Switch to WebView context for interacting with React components
   */
  protected async switchToWebView(): Promise<void> {
    await switchToWebViewContext();
  }

  /**
   * Wait for text to be visible on the page
   */
  protected async waitForText(text: string, timeout = 10000): Promise<void> {
    await switchToWebViewContext();
    const element = await $(`*=${text}`);
    await element.waitForExist({ timeout });
  }

  /**
   * Click element containing text
   */
  protected async clickByText(text: string): Promise<void> {
    await switchToWebViewContext();
    const element = await $(`*=${text}`);
    await element.waitForExist({ timeout: 10000 });
    await element.click();
  }
}
