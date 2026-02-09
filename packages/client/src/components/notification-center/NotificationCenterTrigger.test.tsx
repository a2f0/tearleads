import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationStore } from '@/stores/notificationStore';
import { NotificationCenterTrigger } from './NotificationCenterTrigger';

vi.mock('./NotificationCenter', () => ({
  NotificationCenter: ({
    isOpen,
    onClose
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="notification-center-overlay">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null
}));

describe('NotificationCenterTrigger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders trigger button', () => {
    render(<NotificationCenterTrigger />);
    expect(
      screen.getByRole('button', { name: /open notification center/i })
    ).toBeInTheDocument();
  });

  it('opens Notification Center when clicked', async () => {
    const user = userEvent.setup();
    render(<NotificationCenterTrigger />);

    expect(
      screen.queryByTestId('notification-center-overlay')
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /open notification center/i })
    );

    expect(
      screen.getByTestId('notification-center-overlay')
    ).toBeInTheDocument();
  });

  it('closes Notification Center when close is triggered', async () => {
    const user = userEvent.setup();
    render(<NotificationCenterTrigger />);

    await user.click(
      screen.getByRole('button', { name: /open notification center/i })
    );
    expect(
      screen.getByTestId('notification-center-overlay')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(
      screen.queryByTestId('notification-center-overlay')
    ).not.toBeInTheDocument();
  });

  it('supports context menu actions', async () => {
    const user = userEvent.setup();
    const markAllAsReadSpy = vi.spyOn(notificationStore, 'markAllAsRead');
    const dismissAllSpy = vi.spyOn(notificationStore, 'dismissAll');

    render(<NotificationCenterTrigger />);

    await user.pointer({
      target: screen.getByRole('button', { name: /open notification center/i }),
      keys: '[MouseRight]'
    });

    await user.click(screen.getByRole('button', { name: /mark all as read/i }));
    expect(markAllAsReadSpy).toHaveBeenCalledTimes(1);

    await user.pointer({
      target: screen.getByRole('button', { name: /open notification center/i }),
      keys: '[MouseRight]'
    });
    await user.click(
      screen.getByRole('button', { name: /clear all notifications/i })
    );
    expect(dismissAllSpy).toHaveBeenCalledTimes(1);
  });

  it('subscribes on mount and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    const subscribeSpy = vi
      .spyOn(notificationStore, 'subscribe')
      .mockReturnValue(unsubscribe);
    vi.spyOn(notificationStore, 'getUnreadCount').mockReturnValue(0);

    const { unmount } = render(<NotificationCenterTrigger />);

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
