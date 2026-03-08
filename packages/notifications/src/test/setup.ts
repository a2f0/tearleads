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

// Mock react-i18next to return translation keys with interpolated values
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      // Map translation keys to expected text for tests
      const translations: Record<string, string> = {
        noLogsYet: 'No logs yet',
        logCount: '{{count}} log',
        logCountPlural: '{{count}} logs',
        noNotifications: 'No notifications',
        notificationCount: '{{count}} notification',
        notificationCountPlural: '{{count}} notifications',
        unread: '{{count}} unread',
        copyLogs: 'Copy logs',
        copyLogsToClipboard: 'Copy logs to clipboard',
        clearLogs: 'Clear logs',
        markAllAsRead: 'Mark all as read',
        dismissAll: 'Dismiss all',
        dismissNotification: 'Dismiss notification',
        databaseLocked: 'Database locked',
        loading: 'Loading...',
        noEventsInLastHour: 'No events in the last hour',
        lastHour: 'Last Hour',
        moreEventTypes: '+{{count}} more event types',
        refresh: 'Refresh',
        close: 'Close',
        open: 'Open',
        'menu:file': 'File',
        'menu:help': 'Help',
        'menu:analytics': 'Analytics',
        'menu:logs': 'Logs',
        'menu:notifications': 'Notifications',
        'menu:notificationCenter': 'Notification Center',
        'menu:openNotificationCenter': 'Open Notification Center',
        file: 'File',
        help: 'Help',
        analytics: 'Analytics',
        logs: 'Logs',
        notifications: 'Notifications',
        notificationCenter: 'Notification Center',
        openNotificationCenter: 'Open Notification Center'
      };
      let translated = translations[key] ?? key;
      // Interpolate count values for pluralization
      if (options?.count !== undefined) {
        translated = translated.replace('{{count}}', String(options.count));
      }
      return translated;
    },
    i18n: { language: 'en' }
  })
}));

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
  const unstubAllGlobals = Reflect.get(vi, 'unstubAllGlobals');
  if (typeof unstubAllGlobals === 'function') {
    Reflect.apply(unstubAllGlobals, vi, []);
  }
  cleanup();
});
