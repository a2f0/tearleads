import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WindowManagerContextValue } from '@tearleads/window-manager';
import * as windowManager from '@tearleads/window-manager';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationStore } from '../stores/notificationStore';
import { NotificationCenterTrigger } from './NotificationCenterTrigger';

const mockOpenWindow = vi.fn(() => 'notification-center');
const windowManagerStub: WindowManagerContextValue = {
  windows: [],
  openWindow: (type, id) => {
    mockOpenWindow(type, id);
    return id ?? type;
  },
  closeWindow: () => {},
  focusWindow: () => {},
  minimizeWindow: () => {},
  restoreWindow: () => {},
  updateWindowDimensions: () => {},
  saveWindowDimensionsForType: () => {},
  renameWindow: () => {},
  isWindowOpen: () => false,
  getWindow: () => undefined
};

describe('NotificationCenterTrigger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockOpenWindow.mockClear();
  });

  it('renders trigger button', () => {
    vi
      .spyOn(windowManager, 'useWindowManager')
      .mockReturnValue(windowManagerStub);
    render(<NotificationCenterTrigger />);
    expect(
      screen.getByRole('button', { name: /open notification center/i })
    ).toBeInTheDocument();
  });

  it('opens Notification Center window when clicked', async () => {
    const user = userEvent.setup();
    vi
      .spyOn(windowManager, 'useWindowManager')
      .mockReturnValue(windowManagerStub);
    render(<NotificationCenterTrigger />);

    await user.click(
      screen.getByRole('button', { name: /open notification center/i })
    );

    expect(mockOpenWindow).toHaveBeenCalledWith(
      'notification-center',
      undefined
    );
  });

  it('supports context menu actions', async () => {
    const user = userEvent.setup();
    const markAllAsReadSpy = vi.spyOn(notificationStore, 'markAllAsRead');
    const dismissAllSpy = vi.spyOn(notificationStore, 'dismissAll');
    vi
      .spyOn(windowManager, 'useWindowManager')
      .mockReturnValue(windowManagerStub);

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
    vi
      .spyOn(windowManager, 'useWindowManager')
      .mockReturnValue(windowManagerStub);
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
    if (!menuItem) {
      throw new Error('Expected context menu item');
    }
    await user.click(menuItem);
    expect(mockOpenWindow).toHaveBeenCalledWith(
      'notification-center',
      undefined
    );
  });

  it('subscribes on mount and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    const subscribeSpy = vi
      .spyOn(notificationStore, 'subscribe')
      .mockReturnValue(unsubscribe);
    vi.spyOn(notificationStore, 'getUnreadCount').mockReturnValue(0);
    vi
      .spyOn(windowManager, 'useWindowManager')
      .mockReturnValue(windowManagerStub);

    const { unmount } = render(<NotificationCenterTrigger />);

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
