import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

type FooterProps = {
  children: ReactNode;
  connectionIndicator?: ReactNode;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  version?: string;
  className?: string;
  copyrightText?: string;
};

const mockOpenWindow = vi.fn();
const mockLock = vi.fn();
const mockSetDatabasePassword = vi.fn();
const mockGetInstance = vi.fn();
const mockUpdateInstance = vi.fn();
const mockNotificationWarning = vi.fn();
let mockIsUnlocked = false;
let mockIsAuthenticated = false;
let mockCurrentInstanceId: string | null = null;
let mockInstances: Array<{ id: string; passwordDeferred?: boolean }> = [];

vi.mock('@tearleads/ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter((value): value is string => Boolean(value)).join(' '),
  Footer: ({
    children,
    connectionIndicator,
    leftAction,
    rightAction,
    copyrightText: _copyrightText,
    ...props
  }: FooterProps) => (
    <footer {...props}>
      {leftAction}
      {connectionIndicator}
      {rightAction}
      {children}
    </footer>
  )
}));

vi.mock('@tearleads/window-manager', async () => {
  const actual = await import('@tearleads/window-manager');

  return {
    ...actual
  };
});

vi.mock('@tearleads/ui/logo.svg', () => ({
  default: 'logo.svg'
}));

vi.mock('../components/AccountSwitcher', () => ({
  AccountSwitcher: () => <div data-testid="account-switcher" />
}));

vi.mock('../components/audio/MiniPlayer', () => ({
  MiniPlayer: () => <div data-testid="mini-player" />
}));

vi.mock('../components/language-picker', () => ({
  RuntimeLanguagePicker: () => <div data-testid="runtime-language-picker" />
}));

vi.mock('@/components/notification-center', () => ({
  NotificationCenterTrigger: () => (
    <div data-testid="notification-center-trigger" />
  )
}));

vi.mock('../components/MobileMenu', () => ({
  MobileMenu: () => <div data-testid="mobile-menu" />
}));

vi.mock('../components/screensaver', () => ({
  useScreensaver: () => ({
    isActive: false,
    activate: vi.fn(),
    deactivate: vi.fn()
  })
}));

vi.mock('../components/SettingsButton', () => ({
  SettingsButton: () => <div data-testid="settings-button" />
}));

vi.mock('../components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />
}));

vi.mock('../components/taskbar', () => ({
  Taskbar: () => <div data-testid="taskbar" />
}));

vi.mock('../components/ui/desktop-background', () => ({
  DesktopBackground: () => <div data-testid="desktop-background" />
}));

vi.mock('../db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: mockIsUnlocked,
    lock: mockLock,
    currentInstanceId: mockCurrentInstanceId,
    instances: mockInstances
  })
}));

vi.mock('../db', () => ({
  setDatabasePassword: (...args: unknown[]) => mockSetDatabasePassword(...args)
}));

vi.mock('../db/instanceRegistry', () => ({
  getInstance: (...args: unknown[]) => mockGetInstance(...args),
  updateInstance: (...args: unknown[]) => mockUpdateInstance(...args)
}));

vi.mock('../stores/notificationStore', () => ({
  notificationStore: {
    warning: (...args: unknown[]) => mockNotificationWarning(...args)
  }
}));

vi.mock('../contexts/AuthContext', () => ({
  useOptionalAuth: () => ({
    isAuthenticated: mockIsAuthenticated
  })
}));

vi.mock('../contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: mockOpenWindow
  })
}));

vi.mock('../hooks/ui', () => ({
  useKeyboardHeight: () => 0
}));

vi.mock('./SSESystemTrayItems', () => ({
  SSESystemTrayItems: () => <div data-testid="sse-system-tray-items" />
}));

function buildAppTree() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<div data-testid="outlet" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function renderApp() {
  return render(buildAppTree());
}

describe('App deferred lock flow', () => {
  beforeEach(() => {
    mockOpenWindow.mockReset();
    mockLock.mockReset();
    mockSetDatabasePassword.mockReset();
    mockSetDatabasePassword.mockResolvedValue(true);
    mockGetInstance.mockReset();
    mockGetInstance.mockResolvedValue(null);
    mockUpdateInstance.mockReset();
    mockUpdateInstance.mockResolvedValue(undefined);
    mockNotificationWarning.mockReset();
    mockIsUnlocked = false;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = null;
    mockInstances = [];
  });

  it('requires password before locking deferred signed-out instance', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));

    expect(
      await screen.findByTestId('deferred-lock-password-dialog')
    ).toBeInTheDocument();
    expect(mockNotificationWarning).not.toHaveBeenCalled();
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('shows inline validation when deferred password is empty', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));
    await screen.findByTestId('deferred-lock-password-dialog');
    await user.click(screen.getByTestId('deferred-lock-password-submit'));

    expect(
      screen.getByTestId('deferred-lock-password-error')
    ).toHaveTextContent('Enter a password to continue.');
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('saves password and locks deferred signed-out instance', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));
    await screen.findByTestId('deferred-lock-password-dialog');
    await user.type(
      screen.getByTestId('deferred-lock-password-input'),
      'new-pass'
    );
    await user.click(screen.getByTestId('deferred-lock-password-submit'));

    await waitFor(() => {
      expect(mockSetDatabasePassword).toHaveBeenCalledWith(
        'new-pass',
        'instance-1'
      );
    });
    expect(mockUpdateInstance).toHaveBeenCalledWith('instance-1', {
      passwordDeferred: false
    });
    expect(mockLock).toHaveBeenCalledWith(true);
    expect(
      screen.queryByTestId('deferred-lock-password-dialog')
    ).not.toBeInTheDocument();
  });

  it('shows inline error when deferred password save fails', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockSetDatabasePassword.mockResolvedValue(false);
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));
    await screen.findByTestId('deferred-lock-password-dialog');
    await user.type(
      screen.getByTestId('deferred-lock-password-input'),
      'new-pass'
    );
    await user.click(screen.getByTestId('deferred-lock-password-submit'));

    await waitFor(() => {
      expect(
        screen.getByTestId('deferred-lock-password-error')
      ).toHaveTextContent(
        'Could not save your database password. Please try again.'
      );
    });
    expect(mockNotificationWarning).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('shows inline error when deferred password save throws', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockSetDatabasePassword.mockRejectedValue(new Error('save failed'));
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));
    await screen.findByTestId('deferred-lock-password-dialog');
    await user.type(
      screen.getByTestId('deferred-lock-password-input'),
      'new-pass'
    );
    await user.click(screen.getByTestId('deferred-lock-password-submit'));

    await waitFor(() => {
      expect(
        screen.getByTestId('deferred-lock-password-error')
      ).toHaveTextContent(
        'Could not save your database password. Please try again.'
      );
    });
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('shows inline error when active instance disappears during submit', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    const view = renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));
    await screen.findByTestId('deferred-lock-password-dialog');

    mockCurrentInstanceId = null;
    view.rerender(buildAppTree());

    await user.type(
      screen.getByTestId('deferred-lock-password-input'),
      'new-pass'
    );
    await user.click(screen.getByTestId('deferred-lock-password-submit'));

    expect(
      screen.getByTestId('deferred-lock-password-error')
    ).toHaveTextContent('Could not determine the active database instance.');
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('locks immediately for authenticated users', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = true;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));

    expect(
      screen.queryByTestId('deferred-lock-password-dialog')
    ).not.toBeInTheDocument();
    expect(mockGetInstance).not.toHaveBeenCalled();
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(true);
    });
  });

  it('locks immediately when instance is not deferred', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: false }];
    mockGetInstance.mockResolvedValue({ passwordDeferred: false });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));

    expect(mockGetInstance).toHaveBeenCalledWith('instance-1');
    expect(
      screen.queryByTestId('deferred-lock-password-dialog')
    ).not.toBeInTheDocument();
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(true);
    });
  });

  it('locks when no current instance id is selected', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = null;

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));

    expect(mockGetInstance).not.toHaveBeenCalled();
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('deferred-lock-password-dialog')
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(true);
    });
  });

  it('falls back to instance registry deferred flag before locking', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [];
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));

    await waitFor(() => {
      expect(mockGetInstance).toHaveBeenCalledWith('instance-1');
    });
    await screen.findByTestId('deferred-lock-password-dialog');
    await user.type(
      screen.getByTestId('deferred-lock-password-input'),
      'new-pass'
    );
    await user.click(screen.getByTestId('deferred-lock-password-submit'));
    expect(mockSetDatabasePassword).toHaveBeenCalledWith(
      'new-pass',
      'instance-1'
    );
    expect(mockLock).toHaveBeenCalledWith(true);
  });

  it('dismisses dialog and clears error when cancel is clicked', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [{ id: 'instance-1', passwordDeferred: true }];
    mockGetInstance.mockResolvedValue({ passwordDeferred: true });

    renderApp();

    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));
    await screen.findByTestId('deferred-lock-password-dialog');

    await user.click(screen.getByTestId('deferred-lock-password-cancel'));

    expect(
      screen.queryByTestId('deferred-lock-password-dialog')
    ).not.toBeInTheDocument();
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('blocks lock when deferred state cannot be verified', async () => {
    const user = userEvent.setup();
    mockIsUnlocked = true;
    mockIsAuthenticated = false;
    mockCurrentInstanceId = 'instance-1';
    mockInstances = [];
    mockGetInstance.mockRejectedValue(new Error('lookup failed'));

    renderApp();
    fireEvent.contextMenu(screen.getByTestId('start-button'));
    await user.click(screen.getByText('Lock Instance'));

    expect(mockGetInstance).toHaveBeenCalledWith('instance-1');
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
    expect(mockNotificationWarning).toHaveBeenCalledWith(
      'Unable to Lock Instance',
      'Could not verify database password state. Try again.'
    );
  });
});
