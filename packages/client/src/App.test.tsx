import { render, screen } from '@testing-library/react';
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

vi.mock('./components/hud', () => ({
  HUDTrigger: () => <div data-testid="hud-trigger" />
}));

vi.mock('./components/MobileMenu', () => ({
  MobileMenu: () => <div data-testid="mobile-menu" />
}));

vi.mock('./components/SettingsButton', () => ({
  SettingsButton: () => <div data-testid="settings-button" />
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

  it('renders HUDTrigger outside the header', () => {
    mockUseSSEContext.mockReturnValue(null);

    renderApp();

    const header = screen.getByRole('banner');
    const hudTrigger = screen.getByTestId('hud-trigger');
    expect(hudTrigger).toBeInTheDocument();
    expect(header).not.toContainElement(hudTrigger);
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
});
