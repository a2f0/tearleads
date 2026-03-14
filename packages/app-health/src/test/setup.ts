import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {}
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'exerciseName') return 'Exercise Name';
      if (key === 'category') return 'Category (Optional)';
      if (key === 'addExercise') return 'Add Exercise';
      if (key === 'noExercisesFound') return 'No exercises found';
      if (key === 'variation') {
        const count = options?.count ?? 0;
        return `${count} variation${count === 1 ? '' : 's'}`;
      }
      return key;
    }
  })
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true
});

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

const isBunRuntime = typeof Reflect.get(globalThis, 'Bun') !== 'undefined';

if (!isBunRuntime) {
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

afterEach(() => {
  cleanup();
});
