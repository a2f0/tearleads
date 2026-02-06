/**
 * Tests for notification store.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock localStorage before importing the store
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock
});

// Import after mocking localStorage
const { notificationStore } = await import('./notificationStore');

describe('notificationStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    notificationStore.dismissAll();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('add', () => {
    it('adds a notification', () => {
      notificationStore.add('info', 'Test Title', 'Test message');

      const notifications = notificationStore.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.title).toBe('Test Title');
      expect(notifications[0]?.message).toBe('Test message');
      expect(notifications[0]?.level).toBe('info');
      expect(notifications[0]?.read).toBe(false);
    });

    it('adds notifications in reverse chronological order', () => {
      notificationStore.add('info', 'First', 'First message');
      notificationStore.add('info', 'Second', 'Second message');

      const notifications = notificationStore.getNotifications();
      expect(notifications[0]?.title).toBe('Second');
      expect(notifications[1]?.title).toBe('First');
    });

    it('limits notifications to max count', () => {
      for (let i = 0; i < 60; i++) {
        notificationStore.add('info', `Title ${i}`, `Message ${i}`);
      }

      const notifications = notificationStore.getNotifications();
      expect(notifications.length).toBeLessThanOrEqual(50);
    });
  });

  describe('convenience methods', () => {
    it('info adds info level notification', () => {
      notificationStore.info('Info Title', 'Info message');

      const notifications = notificationStore.getNotifications();
      expect(notifications[0]?.level).toBe('info');
    });

    it('warning adds warning level notification', () => {
      notificationStore.warning('Warning Title', 'Warning message');

      const notifications = notificationStore.getNotifications();
      expect(notifications[0]?.level).toBe('warning');
    });

    it('error adds error level notification', () => {
      notificationStore.error('Error Title', 'Error message');

      const notifications = notificationStore.getNotifications();
      expect(notifications[0]?.level).toBe('error');
    });

    it('success adds success level notification', () => {
      notificationStore.success('Success Title', 'Success message');

      const notifications = notificationStore.getNotifications();
      expect(notifications[0]?.level).toBe('success');
    });
  });

  describe('markAsRead', () => {
    it('marks a notification as read', () => {
      notificationStore.add('info', 'Test', 'Test');

      const notifications = notificationStore.getNotifications();
      expect(notifications[0]?.read).toBe(false);

      notificationStore.markAsRead(notifications[0]?.id ?? '');

      const updated = notificationStore.getNotifications();
      expect(updated[0]?.read).toBe(true);
    });

    it('does nothing for non-existent notification', () => {
      notificationStore.add('info', 'Test', 'Test');

      notificationStore.markAsRead('non-existent-id');

      const notifications = notificationStore.getNotifications();
      expect(notifications[0]?.read).toBe(false);
    });

    it('does nothing for already read notification', () => {
      notificationStore.add('info', 'Test', 'Test');
      const notifications = notificationStore.getNotifications();
      notificationStore.markAsRead(notifications[0]?.id ?? '');
      notificationStore.markAsRead(notifications[0]?.id ?? '');

      const updated = notificationStore.getNotifications();
      expect(updated[0]?.read).toBe(true);
    });
  });

  describe('markAllAsRead', () => {
    it('marks all notifications as read', () => {
      notificationStore.add('info', 'Test 1', 'Test');
      notificationStore.add('info', 'Test 2', 'Test');
      notificationStore.add('info', 'Test 3', 'Test');

      notificationStore.markAllAsRead();

      const notifications = notificationStore.getNotifications();
      expect(notifications.every((n) => n.read)).toBe(true);
    });

    it('does nothing when no notifications', () => {
      notificationStore.markAllAsRead();
      expect(notificationStore.getNotifications()).toHaveLength(0);
    });
  });

  describe('dismiss', () => {
    it('removes a notification', () => {
      notificationStore.add('info', 'Test', 'Test');

      const notifications = notificationStore.getNotifications();
      notificationStore.dismiss(notifications[0]?.id ?? '');

      expect(notificationStore.getNotifications()).toHaveLength(0);
    });

    it('does nothing for non-existent notification', () => {
      notificationStore.add('info', 'Test', 'Test');

      notificationStore.dismiss('non-existent-id');

      expect(notificationStore.getNotifications()).toHaveLength(1);
    });
  });

  describe('dismissAll', () => {
    it('removes all notifications', () => {
      notificationStore.add('info', 'Test 1', 'Test');
      notificationStore.add('info', 'Test 2', 'Test');
      notificationStore.add('info', 'Test 3', 'Test');

      notificationStore.dismissAll();

      expect(notificationStore.getNotifications()).toHaveLength(0);
    });

    it('does nothing when no notifications', () => {
      notificationStore.dismissAll();
      expect(notificationStore.getNotifications()).toHaveLength(0);
    });
  });

  describe('getUnreadCount', () => {
    it('returns count of unread notifications', () => {
      notificationStore.add('info', 'Test 1', 'Test');
      notificationStore.add('info', 'Test 2', 'Test');
      notificationStore.add('info', 'Test 3', 'Test');

      expect(notificationStore.getUnreadCount()).toBe(3);
    });

    it('excludes read notifications from count', () => {
      notificationStore.add('info', 'Test 1', 'Test');
      notificationStore.add('info', 'Test 2', 'Test');

      const notifications = notificationStore.getNotifications();
      notificationStore.markAsRead(notifications[0]?.id ?? '');

      expect(notificationStore.getUnreadCount()).toBe(1);
    });

    it('returns 0 when all notifications are read', () => {
      notificationStore.add('info', 'Test', 'Test');
      notificationStore.markAllAsRead();

      expect(notificationStore.getUnreadCount()).toBe(0);
    });

    it('returns 0 when no notifications', () => {
      expect(notificationStore.getUnreadCount()).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('calls listener when notification is added', () => {
      const listener = vi.fn();
      notificationStore.subscribe(listener);

      notificationStore.add('info', 'Test', 'Test');

      expect(listener).toHaveBeenCalled();
    });

    it('calls listener when notification is dismissed', () => {
      notificationStore.add('info', 'Test', 'Test');
      const notifications = notificationStore.getNotifications();

      const listener = vi.fn();
      notificationStore.subscribe(listener);

      notificationStore.dismiss(notifications[0]?.id ?? '');

      expect(listener).toHaveBeenCalled();
    });

    it('calls listener when notification is marked as read', () => {
      notificationStore.add('info', 'Test', 'Test');
      const notifications = notificationStore.getNotifications();

      const listener = vi.fn();
      notificationStore.subscribe(listener);

      notificationStore.markAsRead(notifications[0]?.id ?? '');

      expect(listener).toHaveBeenCalled();
    });

    it('returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = notificationStore.subscribe(listener);

      unsubscribe();

      notificationStore.add('info', 'Test', 'Test');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('localStorage persistence', () => {
    it('saves notifications to localStorage', () => {
      notificationStore.add('info', 'Test', 'Test message');

      expect(localStorageMock.setItem).toHaveBeenCalled();
      const lastCall = localStorageMock.setItem.mock.calls.at(-1);
      const savedData = lastCall?.[1] ?? '';
      const parsed = JSON.parse(savedData);
      expect(parsed[0].title).toBe('Test');
    });

    it('saves read state to localStorage', () => {
      notificationStore.add('info', 'Test', 'Test');
      const notifications = notificationStore.getNotifications();
      notificationStore.markAsRead(notifications[0]?.id ?? '');

      const savedData = localStorageMock.setItem.mock.calls.at(-1)?.[1] ?? '';
      const parsed = JSON.parse(savedData);
      expect(parsed[0].read).toBe(true);
    });

    it('handles corrupted localStorage data gracefully', async () => {
      // Set up invalid JSON in localStorage
      localStorageMock.getItem.mockReturnValueOnce('invalid json{{{');

      // Re-import to trigger constructor
      vi.resetModules();
      const { notificationStore: freshStore } = await import(
        './notificationStore'
      );

      // Should not throw, just start with empty notifications
      expect(freshStore.getNotifications()).toHaveLength(0);
    });

    it('loads existing notifications from localStorage', async () => {
      const existingData = [
        {
          id: 'test-id',
          timestamp: '2024-01-15T10:00:00.000Z',
          level: 'info',
          title: 'Existing',
          message: 'Existing message',
          read: false
        }
      ];

      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(existingData)
      );

      vi.resetModules();
      const { notificationStore: freshStore } = await import(
        './notificationStore'
      );

      const notifications = freshStore.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.title).toBe('Existing');
      expect(notifications[0]?.timestamp).toBeInstanceOf(Date);
    });

    it('handles localStorage.setItem failure gracefully', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError');
      });

      // Should not throw
      expect(() => {
        notificationStore.add('info', 'Test', 'Test');
      }).not.toThrow();
    });
  });
});
