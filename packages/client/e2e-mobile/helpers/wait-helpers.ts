/**
 * Polling and wait utilities for E2E tests
 * Ported from Maestro's db-helpers.yaml
 */

import { switchToWebViewContext } from './webview-helpers.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

/**
 * Generic polling utility - waits for a predicate to return true
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  errorMessage: string,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  const maxTries = timeout / POLL_INTERVAL;

  for (let i = 0; i < maxTries; i++) {
    try {
      if (await predicate()) {
        return;
      }
    } catch {
      // Predicate threw, continue polling
    }
    await browser.pause(POLL_INTERVAL);
  }

  throw new Error(errorMessage);
}

/**
 * Wait for database status to match expected value
 */
export async function waitForStatus(
  status: 'Not Set Up' | 'Locked' | 'Unlocked',
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  await waitFor(
    async () => {
      await switchToWebViewContext();
      const element = await $('[data-testid="db-status"]');
      if (!(await element.isExisting())) return false;
      const text = await element.getText();
      return text === status;
    },
    `Expected status "${status}"`,
    timeout
  );
}

/**
 * Wait for test result to match expected status and optional text
 */
export async function waitForResult(
  status: 'success' | 'error',
  textMatch?: string,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  await waitFor(
    async () => {
      await switchToWebViewContext();
      const element = await $('[data-testid="db-test-result"]');
      if (!(await element.isExisting())) return false;

      const dataStatus = await element.getAttribute('data-status');
      if (dataStatus !== status) {
        return false;
      }

      if (textMatch) {
        const text = await element.getText();
        return text.includes(textMatch);
      }

      return true;
    },
    `Expected result status "${status}"${textMatch ? ` with "${textMatch}"` : ''}`,
    timeout
  );
}

/**
 * Wait for an element to exist and be visible
 */
export async function waitForElement(
  testId: string,
  timeout = DEFAULT_TIMEOUT
): Promise<WebdriverIO.Element> {
  await switchToWebViewContext();
  const element = await $(`[data-testid="${testId}"]`);
  await element.waitForExist({ timeout });
  return element;
}

/**
 * Wait for text to appear anywhere on the page
 */
export async function waitForText(
  text: string,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  await waitFor(
    async () => {
      await switchToWebViewContext();
      const element = await $(`*=${text}`);
      return element.isExisting();
    },
    `Expected text "${text}" to appear`,
    timeout
  );
}

/**
 * Wait for element to have specific attribute value
 */
export async function waitForAttribute(
  testId: string,
  attribute: string,
  value: string,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  await waitFor(
    async () => {
      await switchToWebViewContext();
      const element = await $(`[data-testid="${testId}"]`);
      if (!(await element.isExisting())) return false;
      const attrValue = await element.getAttribute(attribute);
      return attrValue === value;
    },
    `Expected [data-testid="${testId}"] to have ${attribute}="${value}"`,
    timeout
  );
}
