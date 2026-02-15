/**
 * Tests for NotificationsTab component.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationStore } from '../stores/notificationStore';
import { NotificationsTab } from './NotificationsTab';

describe('NotificationsTab', () => {
  beforeEach(() => {
    act(() => {
      notificationStore.dismissAll();
    });
  });

  afterEach(() => {
    act(() => {
      notificationStore.dismissAll();
    });
    vi.clearAllMocks();
  });

  it('renders empty state when no notifications', () => {
    render(<NotificationsTab />);
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('renders notifications list', () => {
    act(() => {
      notificationStore.add('info', 'Test Title', 'Test message');
    });

    render(<NotificationsTab />);

    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('displays notification count', () => {
    act(() => {
      notificationStore.add('info', 'Test 1', 'Message 1');
      notificationStore.add('info', 'Test 2', 'Message 2');
    });

    render(<NotificationsTab />);

    expect(screen.getByText(/2 notifications/)).toBeInTheDocument();
  });

  it('displays unread count', () => {
    act(() => {
      notificationStore.add('info', 'Test 1', 'Message 1');
      notificationStore.add('info', 'Test 2', 'Message 2');
    });

    render(<NotificationsTab />);

    expect(screen.getByText(/2 unread/)).toBeInTheDocument();
  });

  it('marks notification as read on click', async () => {
    act(() => {
      notificationStore.add('info', 'Test Title', 'Test message');
    });

    render(<NotificationsTab />);

    const notification = screen.getByText('Test Title');
    expect(notification).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(notification);
    });

    expect(notificationStore.getUnreadCount()).toBe(0);
  });

  it('dismisses notification when dismiss button is clicked', async () => {
    act(() => {
      notificationStore.add('info', 'Test Title', 'Test message');
    });

    render(<NotificationsTab />);

    const dismissButton = screen.getByLabelText('Dismiss notification');

    await act(async () => {
      fireEvent.click(dismissButton);
    });

    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('marks all as read when mark all button is clicked', async () => {
    act(() => {
      notificationStore.add('info', 'Test 1', 'Message 1');
      notificationStore.add('info', 'Test 2', 'Message 2');
    });

    render(<NotificationsTab />);

    const markAllButton = screen.getByLabelText('Mark all as read');

    await act(async () => {
      fireEvent.click(markAllButton);
    });

    expect(notificationStore.getUnreadCount()).toBe(0);
  });

  it('dismisses all when dismiss all button is clicked', async () => {
    act(() => {
      notificationStore.add('info', 'Test 1', 'Message 1');
      notificationStore.add('info', 'Test 2', 'Message 2');
    });

    render(<NotificationsTab />);

    const dismissAllButton = screen.getByLabelText('Dismiss all');

    await act(async () => {
      fireEvent.click(dismissAllButton);
    });

    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('hides mark all as read button when all are read', () => {
    act(() => {
      notificationStore.add('info', 'Test', 'Message');
      notificationStore.markAllAsRead();
    });

    render(<NotificationsTab />);

    expect(screen.queryByLabelText('Mark all as read')).not.toBeInTheDocument();
  });

  it('applies correct border color for warning level', () => {
    act(() => {
      notificationStore.add('warning', 'Warning', 'Warning message');
    });

    render(<NotificationsTab />);

    const notification = screen.getByText('Warning').closest('div.border-l-4');
    expect(notification).toHaveClass('border-l-warning');
  });

  it('applies correct border color for error level', () => {
    act(() => {
      notificationStore.add('error', 'Error', 'Error message');
    });

    render(<NotificationsTab />);

    const notification = screen.getByText('Error').closest('div.border-l-4');
    expect(notification).toHaveClass('border-l-destructive');
  });

  it('shows unread indicator for unread notifications', () => {
    act(() => {
      notificationStore.add('info', 'Test', 'Message');
    });

    render(<NotificationsTab />);

    expect(screen.getByTestId('unread-indicator')).toBeInTheDocument();
  });

  it('hides unread indicator for read notifications', async () => {
    act(() => {
      notificationStore.add('info', 'Test', 'Message');
    });

    render(<NotificationsTab />);

    const notification = screen.getByText('Test');

    await act(async () => {
      fireEvent.click(notification);
    });

    expect(screen.queryByTestId('unread-indicator')).not.toBeInTheDocument();
  });

  it('displays relative time for notifications', () => {
    act(() => {
      notificationStore.add('info', 'Test', 'Message');
    });

    render(<NotificationsTab />);

    // Should show "just now" for fresh notification
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('subscribes to store updates', () => {
    render(<NotificationsTab />);

    expect(screen.getByText('No notifications')).toBeInTheDocument();

    // Add notification after render
    act(() => {
      notificationStore.add('info', 'New Notification', 'New message');
    });

    // Component should update
    expect(screen.getByText('New Notification')).toBeInTheDocument();
  });

  describe('context menu', () => {
    it('shows context menu with Mark as read option for unread notification', async () => {
      const user = userEvent.setup();
      act(() => {
        notificationStore.add('info', 'Test', 'Message');
      });

      render(<NotificationsTab />);

      const notification = screen.getByText('Test').closest('div.border-l-4');
      await user.pointer({
        target: notification as HTMLElement,
        keys: '[MouseRight]'
      });

      expect(
        screen.getByRole('button', { name: /mark as read/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^dismiss$/i })
      ).toBeInTheDocument();
    });

    it('hides Mark as read option for read notification', async () => {
      const user = userEvent.setup();
      act(() => {
        notificationStore.add('info', 'Test', 'Message');
        notificationStore.markAllAsRead();
      });

      render(<NotificationsTab />);

      const notification = screen.getByText('Test').closest('div.border-l-4');
      await user.pointer({
        target: notification as HTMLElement,
        keys: '[MouseRight]'
      });

      expect(
        screen.queryByRole('button', { name: /mark as read/i })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^dismiss$/i })
      ).toBeInTheDocument();
    });

    it('marks notification as read via context menu', async () => {
      const user = userEvent.setup();
      act(() => {
        notificationStore.add('info', 'Test', 'Message');
      });

      render(<NotificationsTab />);

      expect(notificationStore.getUnreadCount()).toBe(1);

      const notification = screen.getByText('Test').closest('div.border-l-4');
      await user.pointer({
        target: notification as HTMLElement,
        keys: '[MouseRight]'
      });

      await user.click(screen.getByRole('button', { name: /mark as read/i }));

      expect(notificationStore.getUnreadCount()).toBe(0);
    });

    it('dismisses notification via context menu', async () => {
      const user = userEvent.setup();
      act(() => {
        notificationStore.add('info', 'Test', 'Message');
      });

      render(<NotificationsTab />);

      expect(notificationStore.getNotifications()).toHaveLength(1);

      const notification = screen.getByText('Test').closest('div.border-l-4');
      await user.pointer({
        target: notification as HTMLElement,
        keys: '[MouseRight]'
      });

      await user.click(screen.getByRole('button', { name: /^dismiss$/i }));

      expect(notificationStore.getNotifications()).toHaveLength(0);
    });
  });
});
