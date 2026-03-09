interface CapturedConsoleMessage {
  level: 'warn' | 'error';
  rendered: string;
}

const FAIL_ON_CONSOLE_PATTERNS = [
  /VFS rematerialization bootstrap failed/i,
  /Initial VFS orchestrator flush failed/i,
  /transport returned invalid hasMore/i,
  /page\.items is undefined/i,
  /can't access property Symbol\.iterator, page\.items is undefined/i
];

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

export interface VfsConsoleGuard {
  assertNoRegressions(): void;
  restore(): void;
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
    assertNoRegressions(): void {
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
