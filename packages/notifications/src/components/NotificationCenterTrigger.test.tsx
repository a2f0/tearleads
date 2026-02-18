import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationStore } from '../stores/notificationStore';
import { NotificationCenterTrigger } from './NotificationCenterTrigger';

const mockOpenWindow = vi.fn();

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();
  return {
    ...actual,
    useWindowManager: () => ({ openWindow: mockOpenWindow }),
    DesktopContextMenu: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    DesktopContextMenuItem: ({
      children,
      onClick
    }: {
      children: ReactNode;
      onClick: () => void;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    )
  };
});

describe('NotificationCenterTrigger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockOpenWindow.mockClear();
  });

  it('renders trigger button', () => {
    render(<NotificationCenterTrigger />);
    expect(
      screen.getByRole('button', { name: /open notification center/i })
    ).toBeInTheDocument();
  });

  it('opens Notification Center window when clicked', async () => {
    const user = userEvent.setup();
    render(<NotificationCenterTrigger />);

    await user.click(
      screen.getByRole('button', { name: /open notification center/i })
    );

    expect(mockOpenWindow).toHaveBeenCalledWith('notification-center');
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
    await user.click(screen.getByRole('button', { name: /dismiss all/i }));
    expect(dismissAllSpy).toHaveBeenCalledTimes(1);
  });

  it('opens window from context menu', async () => {
    const user = userEvent.setup();
    render(<NotificationCenterTrigger />);

    await user.pointer({
      target: screen.getByRole('button', { name: /open notification center/i }),
      keys: '[MouseRight]'
    });

    // The context menu item has the exact text "Open Notification Center"
    const menuItems = screen.getAllByRole('button', {
      name: /open notification center/i
    });
    // The second one is the menu item (first is the trigger)
    const menuItem = menuItems[1];
    expect(menuItem).toBeDefined();
    await user.click(menuItem as HTMLElement);
    expect(mockOpenWindow).toHaveBeenCalledWith('notification-center');
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
