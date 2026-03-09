import { shouldFailOnConsoleMessage } from './consoleGuardPatterns.js';

interface ConsoleLike {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

interface CapturedConsoleMessage {
  level: 'warn' | 'error';
  rendered: string;
}

function isErrorLike(
  value: unknown
): value is { name?: unknown; message?: unknown; stack?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('name' in value || 'message' in value || 'stack' in value)
  );
}

function renderConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack ?? arg.message;
  }
  if (isErrorLike(arg)) {
    const stack =
      typeof arg.stack === 'string' && arg.stack.length > 0 ? arg.stack : null;
    if (stack) {
      return stack;
    }

    const message =
      typeof arg.message === 'string' && arg.message.length > 0
        ? arg.message
        : null;
    const name =
      typeof arg.name === 'string' && arg.name.length > 0 ? arg.name : null;
    if (name && message) {
      return `${name}: ${message}`;
    }
    if (message) {
      return message;
    }
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function renderConsoleArgs(args: unknown[]): string {
  return args.map((arg) => renderConsoleArg(arg)).join(' ');
}

function formatGuardrailError(failures: CapturedConsoleMessage[]): Error {
  const details = failures
    .map(
      (entry, index) =>
        `${String(index + 1)}. [${entry.level}] ${entry.rendered}`
    )
    .join('\n\n');
  return new Error(
    `Console guardrail detected VFS bootstrap/flush warnings.\n\n${details}`
  );
}

async function waitForAsyncConsoleFlush(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitForConsoleGracePeriod(gracePeriodMs: number): Promise<void> {
  if (gracePeriodMs <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, gracePeriodMs);
  });
}

export interface ConsoleGuardAssertOptions {
  gracePeriodMs?: number;
}

export interface ConsoleGuardRuntime {
  startTestWindow(): void;
  assertCurrentWindowClean(options?: ConsoleGuardAssertOptions): Promise<void>;
  restore(): void;
}

export function createConsoleGuardRuntime(
  targetConsole: ConsoleLike = console
): ConsoleGuardRuntime {
  const delegatedConsoleError = targetConsole.error.bind(targetConsole);
  const delegatedConsoleWarn = targetConsole.warn.bind(targetConsole);
  const originalConsoleError = targetConsole.error;
  const originalConsoleWarn = targetConsole.warn;

  const capturedMessages: CapturedConsoleMessage[] = [];
  let windowStartIndex = 0;
  let restored = false;

  targetConsole.error = (...args: unknown[]) => {
    const rendered = renderConsoleArgs(args);
    capturedMessages.push({ level: 'error', rendered });
    delegatedConsoleError(...args);
  };

  targetConsole.warn = (...args: unknown[]) => {
    const rendered = renderConsoleArgs(args);
    capturedMessages.push({ level: 'warn', rendered });
    delegatedConsoleWarn(...args);
  };

  return {
    startTestWindow(): void {
      windowStartIndex = capturedMessages.length;
    },
    async assertCurrentWindowClean(
      options: ConsoleGuardAssertOptions = {}
    ): Promise<void> {
      await waitForAsyncConsoleFlush();
      await waitForConsoleGracePeriod(options.gracePeriodMs ?? 0);
      const failures = capturedMessages
        .slice(windowStartIndex)
        .filter((entry) => shouldFailOnConsoleMessage(entry.rendered));
      windowStartIndex = capturedMessages.length;
      if (failures.length > 0) {
        throw formatGuardrailError(failures);
      }
    },
    restore(): void {
      if (restored) {
        return;
      }
      restored = true;
      targetConsole.error = originalConsoleError;
      targetConsole.warn = originalConsoleWarn;
    }
  };
}
