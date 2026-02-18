import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEventHandler, ReactNode } from 'react';
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

const mockUseSSEContext = vi.fn();
const mockUseAppVersion = vi.fn();
const mockOpenWindow = vi.fn();
const mockLock = vi.fn();
let mockIsUnlocked = false;
let mockKeyboardHeight = 0;

vi.mock('@tearleads/ui', () => ({
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

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    WindowConnectionIndicator: ({
      state,
      onContextMenu
    }: {
      state: string;
      onContextMenu?: MouseEventHandler<HTMLButtonElement>;
    }) => (
      <button
        type="button"
        data-testid="connection-indicator"
        onContextMenu={onContextMenu}
      >
        {state}
      </button>
    )
  };
});

vi.mock('@tearleads/ui/logo.svg', () => ({
  default: 'logo.svg'
}));

vi.mock('./components/AccountSwitcher', () => ({
  AccountSwitcher: () => <div data-testid="account-switcher" />
}));

vi.mock('./components/audio/MiniPlayer', () => ({
  MiniPlayer: () => <div data-testid="mini-player" />
}));

vi.mock('./components/language-picker', () => ({
  RuntimeLanguagePicker: () => <div data-testid="runtime-language-picker" />
}));

vi.mock('@/components/notification-center', () => ({
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
    isUnlocked: mockIsUnlocked,
    lock: mockLock
  })
}));

vi.mock('./contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    openWindow: mockOpenWindow
  }),
  useWindowManagerActions: () => ({
    openWindow: mockOpenWindow
  })
}));

vi.mock('./hooks/useAppVersion', () => ({
  useAppVersion: () => mockUseAppVersion()
}));

vi.mock('./hooks/useKeyboardHeight', () => ({
  useKeyboardHeight: () => mockKeyboardHeight
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
          <Route path="search" element={<div data-testid="search-page" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('App', () => {
  beforeEach(() => {
    mockUseAppVersion.mockReturnValue('1.2.3');
    mockOpenWindow.mockReset();
    mockLock.mockReset();
    mockIsUnlocked = false;
    mockKeyboardHeight = 0;
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

  it('renders NotificationCenterTrigger outside the header', async () => {
    mockUseSSEContext.mockReturnValue(null);

    renderApp();

    const header = screen.getByRole('banner');
    // NotificationCenterTrigger is lazy-loaded, so we need to wait for it
    const notificationCenterTrigger = await screen.findByTestId(
      'notification-center-trigger'
    );
    expect(notificationCenterTrigger).toBeInTheDocument();
    expect(header).not.toContainElement(notificationCenterTrigger);
  });

  it('updates mobile state when media query change fires', () => {
    const mediaListeners: Array<(event: MediaQueryListEvent) => void> = [];
    const pointerListeners: Array<(event: MediaQueryListEvent) => void> = [];

    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const isMobileQuery = query === '(max-width: 1023px)';
      const listeners = isMobileQuery ? mediaListeners : pointerListeners;
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_type: string, cb: EventListener) => {
          listeners.push(cb as (event: MediaQueryListEvent) => void);
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      } as MediaQueryList;
    });

    mockUseSSEContext.mockReturnValue(null);
    renderApp();

    const mobileListener = mediaListeners[0];
    if (mobileListener) {
      act(() => {
        mobileListener({ matches: true } as MediaQueryListEvent);
      });
    }

    expect(screen.getByTestId('mobile-menu')).toBeInTheDocument();
  });

  it('renders taskbar in the footer', () => {
    mockUseSSEContext.mockReturnValue(null);

    renderApp();

    const footer = screen.getByRole('contentinfo');
    const taskbar = screen.getByTestId('taskbar');
    expect(footer).toContainElement(taskbar);
  });

  it('adds keyboard offset padding when keyboard height is present', () => {
    mockUseSSEContext.mockReturnValue(null);
    mockKeyboardHeight = 100;

    renderApp();

    expect(screen.getByTestId('outlet').parentElement).toHaveStyle({
      paddingBottom: '164px'
    });
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

      expect(screen.getByText('Open Search')).toBeInTheDocument();
      expect(screen.getByText('Lock Instance')).toBeInTheDocument();
    });

    it('shows context menu on right-click of start bar', () => {
      mockUseSSEContext.mockReturnValue(null);

      renderApp();

      const startBar = screen.getByTestId('start-bar');
      fireEvent.contextMenu(startBar);

      expect(screen.getByText('Open Search')).toBeInTheDocument();
      expect(screen.getByText('Lock Instance')).toBeInTheDocument();
    });

    it('closes context menu when pressing Escape', () => {
      mockUseSSEContext.mockReturnValue(null);

      renderApp();

      const startButton = screen.getByTestId('start-button');
      fireEvent.contextMenu(startButton);

      expect(screen.getByText('Open Search')).toBeInTheDocument();
      expect(screen.getByText('Lock Instance')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByText('Open Search')).not.toBeInTheDocument();
      expect(screen.queryByText('Lock Instance')).not.toBeInTheDocument();
    });

    it('shows search-only context menu on right-click of footer area', () => {
      mockUseSSEContext.mockReturnValue(null);

      renderApp();

      const footer = screen.getByRole('contentinfo');
      fireEvent.contextMenu(footer);

      expect(screen.getByText('Open Search')).toBeInTheDocument();
      expect(screen.queryByText('Lock Instance')).not.toBeInTheDocument();
    });

    it('navigates to search on mobile when Open Search is clicked', async () => {
      const user = userEvent.setup();
      mockUseSSEContext.mockReturnValue(null);
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
        const isMobileQuery = query === '(max-width: 1023px)';
        return {
          matches: isMobileQuery,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn()
        } as MediaQueryList;
      });

      renderApp();

      fireEvent.contextMenu(screen.getByTestId('start-button'));
      await user.click(screen.getByText('Open Search'));

      expect(screen.getByTestId('search-page')).toBeInTheDocument();
      expect(mockOpenWindow).not.toHaveBeenCalled();
    });

    it('opens search window on desktop when Open Search is clicked', async () => {
      const user = userEvent.setup();
      mockUseSSEContext.mockReturnValue(null);
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }) as MediaQueryList);

      renderApp();

      fireEvent.contextMenu(screen.getByTestId('start-button'));
      await user.click(screen.getByText('Open Search'));

      expect(mockOpenWindow).toHaveBeenCalledWith('search');
      expect(screen.queryByText('Open Search')).not.toBeInTheDocument();
    });

    it('locks instance when lock action is clicked and database is unlocked', async () => {
      const user = userEvent.setup();
      mockUseSSEContext.mockReturnValue(null);
      mockIsUnlocked = true;

      renderApp();

      fireEvent.contextMenu(screen.getByTestId('start-button'));
      await user.click(screen.getByText('Lock Instance'));

      expect(mockLock).toHaveBeenCalledWith(true);
    });
  });

  describe('SSE context menu', () => {
    beforeEach(() => {
      mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });
      renderApp();
    });

    function openContextMenu() {
      fireEvent.contextMenu(screen.getByTestId('connection-indicator'));
    }

    it('shows context menu on right-click of connection indicator', () => {
      openContextMenu();

      expect(screen.getByText('Connection Details')).toBeInTheDocument();
    });

    it('opens SSE connection dialog when clicking Connection Details', async () => {
      const user = userEvent.setup();

      openContextMenu();

      await user.click(screen.getByText('Connection Details'));

      expect(screen.getByTestId('sse-connection-dialog')).toBeInTheDocument();
    });

    it('closes context menu when clicking Connection Details', async () => {
      const user = userEvent.setup();

      openContextMenu();

      await user.click(screen.getByText('Connection Details'));

      expect(screen.queryByText('Connection Details')).not.toBeInTheDocument();
    });

    it('closes context menu when pressing Escape', () => {
      openContextMenu();

      expect(screen.getByText('Connection Details')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByText('Connection Details')).not.toBeInTheDocument();
    });

    it('closes SSE connection dialog when onClose is called', async () => {
      const user = userEvent.setup();

      openContextMenu();

      await user.click(screen.getByText('Connection Details'));
      expect(screen.getByTestId('sse-connection-dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(
        screen.queryByTestId('sse-connection-dialog')
      ).not.toBeInTheDocument();
    });
  });
});
