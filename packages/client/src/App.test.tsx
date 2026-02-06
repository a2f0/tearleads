import { fireEvent, render, screen } from '@testing-library/react';
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
};

const mockUseSSEContext = vi.fn();
const mockUseAppVersion = vi.fn();

vi.mock('@rapid/ui', () => ({
  ConnectionIndicator: ({ state }: { state: string }) => (
    <div data-testid="connection-indicator">{state}</div>
  ),
  Footer: ({
    children,
    connectionIndicator,
    leftAction,
    rightAction
  }: FooterProps) => (
    <footer>
      {leftAction}
      {connectionIndicator}
      {rightAction}
      {children}
    </footer>
  )
}));

vi.mock('@rapid/ui/logo.svg', () => ({
  default: 'logo.svg'
}));

vi.mock('./components/AccountSwitcher', () => ({
  AccountSwitcher: () => <div data-testid="account-switcher" />
}));

vi.mock('./components/audio/MiniPlayer', () => ({
  MiniPlayer: () => <div data-testid="mini-player" />
}));

vi.mock('./components/notification-center', () => ({
  NotificationCenterTrigger: () => (
    <div data-testid="notification-center-trigger" />
  )
}));

vi.mock('./components/MobileMenu', () => ({
  MobileMenu: () => <div data-testid="mobile-menu" />
}));

vi.mock('./components/screensaver', () => ({
  useScreensaver: () => ({
    isActive: false,
    activate: vi.fn(),
    deactivate: vi.fn()
  })
}));

vi.mock('./components/SettingsButton', () => ({
  SettingsButton: () => <div data-testid="settings-button" />
}));

vi.mock('./components/SSEConnectionDialog', () => ({
  SSEConnectionDialog: ({
    isOpen,
    onClose
  }: {
    isOpen: boolean;
    onClose: () => void;
    connectionState: string;
  }) =>
    isOpen ? (
      <div data-testid="sse-connection-dialog">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />
}));

vi.mock('./components/window-renderer', () => ({
  WindowRenderer: () => null
}));

vi.mock('./components/taskbar', () => ({
  Taskbar: () => <div data-testid="taskbar" />
}));

vi.mock('./components/ui/desktop-background', () => ({
  DesktopBackground: () => <div data-testid="desktop-background" />
}));

vi.mock('./db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: false,
    lock: vi.fn()
  })
}));

vi.mock('./hooks/useAppVersion', () => ({
  useAppVersion: () => mockUseAppVersion()
}));

vi.mock('./sse', () => ({
  useSSEContext: () => mockUseSSEContext()
}));

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<div data-testid="outlet" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('App', () => {
  beforeEach(() => {
    mockUseAppVersion.mockReturnValue('1.2.3');
  });

  it('hides the connection indicator without SSE', () => {
    mockUseSSEContext.mockReturnValue(null);

    renderApp();

    expect(screen.queryByTestId('connection-indicator')).toBeNull();
  });

  it('shows the connection indicator when SSE is available', () => {
    mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

    renderApp();

    expect(screen.getByTestId('connection-indicator')).toHaveTextContent(
      'connected'
    );
  });

  it('renders NotificationCenterTrigger outside the header', () => {
    mockUseSSEContext.mockReturnValue(null);

    renderApp();

    const header = screen.getByRole('banner');
    const notificationCenterTrigger = screen.getByTestId(
      'notification-center-trigger'
    );
    expect(notificationCenterTrigger).toBeInTheDocument();
    expect(header).not.toContainElement(notificationCenterTrigger);
  });

  it('renders taskbar in the footer', () => {
    mockUseSSEContext.mockReturnValue(null);

    renderApp();

    const footer = screen.getByRole('contentinfo');
    const taskbar = screen.getByTestId('taskbar');
    expect(footer).toContainElement(taskbar);
  });

  it('renders the connection indicator outside the footer', () => {
    mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

    renderApp();

    const footer = screen.getByRole('contentinfo');
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator).toBeInTheDocument();
    expect(footer).not.toContainElement(indicator);
  });

  describe('Start menu context menu', () => {
    it('shows context menu on right-click of start button', () => {
      mockUseSSEContext.mockReturnValue(null);

      renderApp();

      const startButton = screen.getByTestId('start-button');
      fireEvent.contextMenu(startButton);

      expect(screen.getByText('Lock Instance')).toBeInTheDocument();
    });

    it('closes context menu when pressing Escape', () => {
      mockUseSSEContext.mockReturnValue(null);

      renderApp();

      const startButton = screen.getByTestId('start-button');
      fireEvent.contextMenu(startButton);

      expect(screen.getByText('Lock Instance')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByText('Lock Instance')).not.toBeInTheDocument();
    });
  });

  describe('SSE context menu', () => {
    it('shows context menu on right-click of connection indicator', () => {
      mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

      renderApp();

      const indicatorContainer = screen.getByTestId(
        'connection-indicator'
      ).parentElement;
      if (indicatorContainer) {
        fireEvent.contextMenu(indicatorContainer);
      }

      expect(screen.getByText('Connection Details')).toBeInTheDocument();
    });

    it('opens SSE connection dialog when clicking Connection Details', async () => {
      const user = userEvent.setup();
      mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

      renderApp();

      const indicatorContainer = screen.getByTestId(
        'connection-indicator'
      ).parentElement;
      if (indicatorContainer) {
        fireEvent.contextMenu(indicatorContainer);
      }

      await user.click(screen.getByText('Connection Details'));

      expect(screen.getByTestId('sse-connection-dialog')).toBeInTheDocument();
    });

    it('closes context menu when clicking Connection Details', async () => {
      const user = userEvent.setup();
      mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

      renderApp();

      const indicatorContainer = screen.getByTestId(
        'connection-indicator'
      ).parentElement;
      if (indicatorContainer) {
        fireEvent.contextMenu(indicatorContainer);
      }

      await user.click(screen.getByText('Connection Details'));

      expect(screen.queryByText('Connection Details')).not.toBeInTheDocument();
    });

    it('closes context menu when pressing Escape', () => {
      mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

      renderApp();

      const indicatorContainer = screen.getByTestId(
        'connection-indicator'
      ).parentElement;
      if (indicatorContainer) {
        fireEvent.contextMenu(indicatorContainer);
      }

      expect(screen.getByText('Connection Details')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByText('Connection Details')).not.toBeInTheDocument();
    });

    it('closes SSE connection dialog when onClose is called', async () => {
      const user = userEvent.setup();
      mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

      renderApp();

      const indicatorContainer = screen.getByTestId(
        'connection-indicator'
      ).parentElement;
      if (indicatorContainer) {
        fireEvent.contextMenu(indicatorContainer);
      }

      await user.click(screen.getByText('Connection Details'));
      expect(screen.getByTestId('sse-connection-dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(
        screen.queryByTestId('sse-connection-dialog')
      ).not.toBeInTheDocument();
    });
  });
});
