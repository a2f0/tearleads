import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        sync: 'Sync',
        login: 'Sign In',
        signIn: 'Sign in',
        createOne: 'Create one',
        createAccount: 'Create Account',
        loggedInAs: 'Logged in as',
        tokenExpires: 'Token expires',
        expiresIn: 'in {{time}}',
        expired: 'Expired',
        emailAddress: 'Email address',
        logout: 'Logout',
        file: 'File',
        view: 'View',
        close: 'Close',
        help: 'Help',
        accountTab: 'Account',
        queueTab: 'Queue',
        noPendingOperations: 'No pending operations',
        allSynced: 'All data is synced',
        inboundStatus: 'Inbound Status',
        cursor: 'Cursor',
        noCursor: 'None',
        pendingOps: 'Pending',
        nextWriteId: 'Next Write ID',
        crdtOperations: 'CRDT Operations',
        blobOperations: 'Blob Operations',
        encrypted: 'Encrypted',
        inboundBlobDownloads: 'Inbound Blob Downloads',
        outboundBlobActivity: 'Recent Blob Uploads'
      };
      let translated = translations[key] ?? key;
      if (options?.time !== undefined) {
        translated = translated.replace('{{time}}', String(options.time));
      }
      return translated;
    }
  })
}));

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
