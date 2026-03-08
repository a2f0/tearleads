import '@testing-library/jest-dom/vitest';
import {
  formatConsoleArg,
  installVitestPolyfills
} from '@tearleads/bun-dom-compat';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

const isBunRuntime = typeof Reflect.get(globalThis, 'Bun') !== 'undefined';
const { hasCustomStubber, unstubAllGlobals } = installVitestPolyfills(
  vi as unknown as Record<string, unknown>
);

// Allow expected warnings from SQLite WASM (used in integration tests)
const allowedWarnings = [
  'Ignoring inability to install OPFS sqlite3_vfs',
  'sqlite3_step() rc='
];

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
let bunConsoleErrors: string[] = [];

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (isBunRuntime) {
    bunConsoleErrors = [];
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      bunConsoleErrors.push(args.map(formatConsoleArg).join(' '));
    });
  }
});

afterEach(() => {
  const unexpectedWarnings: unknown[][] = [];

  if (warnSpy) {
    for (const call of warnSpy.mock.calls) {
      const firstArg = call[0];
      const message = formatConsoleArg(firstArg);
      if (!allowedWarnings.some((allowed) => message.includes(allowed))) {
        unexpectedWarnings.push(call);
      }
    }

    warnSpy.mockRestore();
    warnSpy = null;
  }

  if (errorSpy) {
    errorSpy.mockRestore();
    errorSpy = null;
  }

  if (hasCustomStubber) {
    unstubAllGlobals();
  }

  cleanup();

  expect(unexpectedWarnings).toEqual([]);

  if (isBunRuntime && bunConsoleErrors.length > 0) {
    throw new Error(
      `Unexpected console errors:\n${bunConsoleErrors.join('\n')}`
    );
  }
});

if (!isBunRuntime) {
  failOnConsole({
    shouldFailOnWarn: false,
    shouldFailOnError: true
  });
}
