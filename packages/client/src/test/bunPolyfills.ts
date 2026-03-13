import { formatConsoleArg } from '@tearleads/bun-dom-compat';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Install Bun-specific polyfills for vitest APIs that Bun 1.3 doesn't
 * support: vi.importActual, vi.stubEnv, vi.unstubAllEnvs, and
 * failOnConsole-equivalent console capture.
 */
export function installBunPolyfills(): void {
  const stubbedEnvValues = new Map<string, string | undefined>();

  if (typeof Reflect.get(vi, 'importActual') !== 'function') {
    // Bun 1.3 doesn't support vi.importActual — its mock layer intercepts
    // all import()/require() calls, so there's no way to load the real
    // module inside a vi.mock factory.  Return {} to avoid deadlocks;
    // tests that spread actual exports will lose originals but won't hang.
    Reflect.set(
      vi,
      'importActual',
      async (): Promise<Record<string, unknown>> => ({})
    );
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

  // Console capture (failOnConsole equivalent)
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
