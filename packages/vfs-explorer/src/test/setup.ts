import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

const isBunRuntime = typeof Reflect.get(globalThis, 'Bun') !== 'undefined';
let hasCustomGlobalStubber = false;

if (typeof Reflect.get(vi, 'mocked') !== 'function') {
  Reflect.set(vi, 'mocked', <T>(value: T) => value);
}

if (typeof Reflect.get(vi, 'stubGlobal') !== 'function') {
  hasCustomGlobalStubber = true;
  const stubbedGlobals = new Map<
    string,
    { hadValue: boolean; value: unknown }
  >();

  Reflect.set(vi, 'stubGlobal', (name: string, value: unknown) => {
    if (!stubbedGlobals.has(name)) {
      stubbedGlobals.set(name, {
        hadValue: Reflect.has(globalThis, name),
        value: Reflect.get(globalThis, name)
      });
    }
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value
    });
  });

  Reflect.set(vi, 'unstubAllGlobals', () => {
    for (const [name, original] of stubbedGlobals) {
      if (original.hadValue) {
        Object.defineProperty(globalThis, name, {
          configurable: true,
          writable: true,
          value: original.value
        });
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
    stubbedGlobals.clear();
  });
}

// Allow expected warnings from SQLite WASM (used in integration tests)
const allowedWarnings = [
  'Ignoring inability to install OPFS sqlite3_vfs',
  'sqlite3_step() rc='
];

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
let bunConsoleErrors: string[] = [];

function formatConsoleArg(arg: unknown): string {
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
}

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

  if (hasCustomGlobalStubber) {
    const unstubAllGlobals = Reflect.get(vi, 'unstubAllGlobals');
    if (typeof unstubAllGlobals === 'function') {
      Reflect.apply(unstubAllGlobals, vi, []);
    }
  }

  cleanup();

  expect(unexpectedWarnings).toEqual([]);

  if (isBunRuntime && bunConsoleErrors.length > 0) {
    throw new Error(`Unexpected console errors:\n${bunConsoleErrors.join('\n')}`);
  }
});

if (!isBunRuntime) {
  failOnConsole({
    shouldFailOnWarn: false,
    shouldFailOnError: true
  });
}
