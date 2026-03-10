import '@testing-library/jest-dom/vitest';
import {
  formatConsoleArg,
  installVitestPolyfills
} from '@tearleads/bun-dom-compat';
import { cleanup } from '@testing-library/react';
import * as reactRouterDomActual from 'react-router-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

// Initialize i18n for tests (side-effect import)
import '../i18n/testI18n';

const isBunRuntime = typeof Reflect.get(globalThis, 'Bun') !== 'undefined';
const { hasCustomStubber, unstubAllGlobals } = installVitestPolyfills(vi);

if (!isBunRuntime) {
  failOnConsole();
} else {
  const stubbedEnvValues = new Map<string, string | undefined>();

  if (typeof Reflect.get(vi, 'importActual') !== 'function') {
    Reflect.set(vi, 'importActual', async (modulePath: string) => {
      if (modulePath === 'react-router-dom') {
        return reactRouterDomActual;
      }
      return import(modulePath);
    });
  }
  if (typeof Reflect.get(vi, 'resetModules') !== 'function') {
    Reflect.set(vi, 'resetModules', () => {});
  }
  if (typeof Reflect.get(vi, 'stubEnv') !== 'function') {
    Reflect.set(vi, 'stubEnv', (key: string, value: string) => {
      if (!stubbedEnvValues.has(key)) {
        const currentValue = process.env[key];
        stubbedEnvValues.set(
          key,
          typeof currentValue === 'string' ? currentValue : undefined
        );
      }
      process.env[key] = value;
    });
  }
  if (typeof Reflect.get(vi, 'unstubAllEnvs') !== 'function') {
    Reflect.set(vi, 'unstubAllEnvs', () => {
      for (const [key, value] of stubbedEnvValues) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      stubbedEnvValues.clear();
    });
  }

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  let consoleMessages: string[] = [];

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
  if (hasCustomStubber) {
    unstubAllGlobals();
  }
  cleanup();
});
