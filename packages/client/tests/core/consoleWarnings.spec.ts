import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clearOriginStorage } from '../testUtils';

const IGNORED_WARNING_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /apple-mobile-web-app-capable.*deprecated/i,
  // web-llm warnings during model cache checks (expected in test environment)
  /Failed to check cached models/i,
  // Network errors are expected when API server isn't running (PWA works offline)
  /ERR_CONNECTION_REFUSED/i,
  /Failed to load resource/i
];

interface ConsoleMessage {
  level: string;
  text: string;
  source?: string | undefined;
  url?: string | undefined;
}

async function setupConsoleCapture(page: Page): Promise<ConsoleMessage[]> {
  const messages: ConsoleMessage[] = [];

  // Use CDP to capture browser-level warnings (deprecations, security, etc.)
  const client = await page.context().newCDPSession(page);
  await client.send('Log.enable');

  client.on('Log.entryAdded', (event) => {
    const { level, text, source, url } = event.entry;
    if (level === 'warning' || level === 'error') {
      messages.push({ level, text, source, url });
    }
  });

  // Capture JavaScript console.warn() and console.error() calls
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'warning' || type === 'error') {
      messages.push({
        level: type,
        text: msg.text(),
        url: msg.location().url
      });
    }
  });

  return messages;
}

function filterIgnoredWarnings(messages: ConsoleMessage[]): ConsoleMessage[] {
  return messages.filter(
    (msg) => !IGNORED_WARNING_PATTERNS.some((pattern) => pattern.test(msg.text))
  );
}

function formatMessages(messages: ConsoleMessage[]): string {
  return messages
    .map((m) => `[${m.level}] ${m.text}${m.url ? ` (${m.url})` : ''}`)
    .join('\n');
}

test.describe('Console warnings', () => {
  test('should have no console warnings or errors on page load', async ({
    page
  }) => {
    const messages = await setupConsoleCapture(page);

    await clearOriginStorage(page);
    await page.goto('/');
    // Wait for page content to load (can't use networkidle due to SSE connection)
    await page.waitForLoadState('domcontentloaded');
    // Give time for initial render and any async operations
    await page.waitForTimeout(1000);

    const relevantMessages = filterIgnoredWarnings(messages);

    expect(
      relevantMessages,
      `Found console issues:\n${formatMessages(relevantMessages)}`
    ).toEqual([]);
  });
});
