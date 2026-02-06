import { afterEach, beforeEach, expect, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

// Allow expected warnings from SQLite WASM
const allowedWarnings = [
  'Ignoring inability to install OPFS sqlite3_vfs',
  'sqlite3_step() rc='
];

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  if (warnSpy) {
    const unexpectedWarnings = warnSpy.mock.calls.filter((call: unknown[]) => {
      const firstArg = call[0];
      const message =
        typeof firstArg === 'string'
          ? firstArg
          : firstArg instanceof Error
            ? firstArg.message
            : String(firstArg);
      return !allowedWarnings.some((allowed) => message.includes(allowed));
    });

    expect(unexpectedWarnings).toEqual([]);
    warnSpy.mockRestore();
    warnSpy = null;
  }
});

// Still fail on console.error
failOnConsole({
  shouldFailOnWarn: false,
  shouldFailOnError: true
});
