import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

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

failOnConsole();

afterEach(() => {
  cleanup();
});
