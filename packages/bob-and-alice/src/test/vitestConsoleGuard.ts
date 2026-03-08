import { afterEach, beforeEach } from 'vitest';
import { shouldFailOnConsoleMessage } from './consoleGuardPatterns.js';

interface CapturedConsoleMessage {
  level: 'warn' | 'error';
  rendered: string;
}

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
let capturedMessages: CapturedConsoleMessage[] = [];

function renderConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack ?? arg.message;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

beforeEach(() => {
  capturedMessages = [];

  console.error = (...args: unknown[]) => {
    const rendered = renderConsoleArgs(args);
    capturedMessages.push({ level: 'error', rendered });
    originalConsoleError(...args);
  };

  console.warn = (...args: unknown[]) => {
    const rendered = renderConsoleArgs(args);
    capturedMessages.push({ level: 'warn', rendered });
    originalConsoleWarn(...args);
  };
});

afterEach(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;

  const guardrailFailures = capturedMessages.filter((entry) =>
    shouldFailOnConsoleMessage(entry.rendered)
  );
  if (guardrailFailures.length === 0) {
    return;
  }

  const details = guardrailFailures
    .map(
      (entry, index) =>
        `${String(index + 1)}. [${entry.level}] ${entry.rendered}`
    )
    .join('\n\n');
  throw new Error(
    `Console guardrail detected VFS bootstrap/flush warnings.\n\n${details}`
  );
});
