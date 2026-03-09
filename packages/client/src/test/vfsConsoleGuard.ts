interface CapturedConsoleMessage {
  level: 'warn' | 'error';
  rendered: string;
}

const FAIL_ON_CONSOLE_PATTERNS = [
  /VFS rematerialization bootstrap failed/i,
  /Initial VFS orchestrator flush failed/i,
  /VfsCrdtFeedReplayError/i,
  /CRDT feed item \d+ is not strictly newer than local cursor/i,
  /transport returned invalid hasMore/i,
  /page\.items is undefined/i,
  /can't access property Symbol\.iterator, page\.items is undefined/i
];

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

export interface VfsConsoleGuard {
  assertNoRegressions(options?: { gracePeriodMs?: number }): Promise<void>;
  restore(): void;
}

async function waitForAsyncConsoleFlush(gracePeriodMs = 0): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  if (gracePeriodMs > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, gracePeriodMs);
    });
  }
}

export function installVfsConsoleGuard(): VfsConsoleGuard {
  const delegatedConsoleError = console.error.bind(console);
  const delegatedConsoleWarn = console.warn.bind(console);
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const capturedMessages: CapturedConsoleMessage[] = [];

  console.error = (...args: unknown[]) => {
    const rendered = renderConsoleArgs(args);
    capturedMessages.push({ level: 'error', rendered });
    delegatedConsoleError(...args);
  };

  console.warn = (...args: unknown[]) => {
    const rendered = renderConsoleArgs(args);
    capturedMessages.push({ level: 'warn', rendered });
    delegatedConsoleWarn(...args);
  };

  return {
    async assertNoRegressions(options: { gracePeriodMs?: number } = {}) {
      await waitForAsyncConsoleFlush(options.gracePeriodMs ?? 0);
      const failures = capturedMessages.filter((entry) =>
        FAIL_ON_CONSOLE_PATTERNS.some((pattern) => pattern.test(entry.rendered))
      );
      if (failures.length === 0) {
        return;
      }

      const details = failures
        .map(
          (entry, index) =>
            `${String(index + 1)}. [${entry.level}] ${entry.rendered}`
        )
        .join('\n\n');
      throw new Error(
        `Console guardrail detected VFS bootstrap/flush warnings.\n\n${details}`
      );
    },
    restore(): void {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    }
  };
}
