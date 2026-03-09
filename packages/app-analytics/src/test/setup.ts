import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

const isBunRuntime = typeof Reflect.get(globalThis, 'Bun') !== 'undefined';

if (typeof Reflect.get(vi, 'mocked') !== 'function') {
  Reflect.set(vi, 'mocked', <T>(value: T) => value);
}

if (typeof Reflect.get(vi, 'stubGlobal') !== 'function') {
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

if (!isBunRuntime) {
  // Guardrail: fail tests on console warnings/errors unless tests explicitly mock or assert them.
  failOnConsole();
} else {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  let consoleMessages: string[] = [];

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
    consoleMessages = [];
    console.error = (...args: unknown[]) => {
      consoleMessages.push(`error: ${args.map(formatConsoleArg).join(' ')}`);
      originalConsoleError(...args);
    };
    console.warn = (...args: unknown[]) => {
      consoleMessages.push(`warn: ${args.map(formatConsoleArg).join(' ')}`);
      originalConsoleWarn(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    if (consoleMessages.length > 0) {
      throw new Error(
        `Unexpected console output:\n${consoleMessages.join('\n')}`
      );
    }
  });
}

// Mock matchMedia for ThemeProvider
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

// Mock localStorage
const localStorageStore: Record<string, string> = {};
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageStore[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageStore[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(localStorageStore)) {
        delete localStorageStore[key];
      }
    }),
    key: vi.fn(
      (index: number) => Object.keys(localStorageStore)[index] ?? null
    ),
    get length() {
      return Object.keys(localStorageStore).length;
    }
  },
  writable: true
});

// Mock ResizeObserver for components that use it (e.g., DurationChart)
class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: MockResizeObserver
});

afterEach(() => {
  const unstubAllGlobals = Reflect.get(vi, 'unstubAllGlobals');
  if (typeof unstubAllGlobals === 'function') {
    Reflect.apply(unstubAllGlobals, vi, []);
  }
  cleanup();
});
