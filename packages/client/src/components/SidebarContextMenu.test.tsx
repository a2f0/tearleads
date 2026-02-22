import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { i18n } from '@/i18n';
import { Sidebar } from './Sidebar';

const mockNavigate = vi.fn();
const mockOpenWindow = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('@/contexts/WindowManagerContext', async () => {
  const actual = await vi.importActual('@/contexts/WindowManagerContext');
  return {
    ...actual,
    useWindowManagerActions: () => ({
      openWindow: mockOpenWindow,
      requestWindowOpen: vi.fn(),
      closeWindow: vi.fn(),
      focusWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      restoreWindow: vi.fn(),
      updateWindowDimensions: vi.fn(),
      saveWindowDimensionsForType: vi.fn()
    })
  };
});

function mockMatchMedia({
  isMobile,
  isTouch = false
}: {
  isMobile: boolean;
  isTouch?: boolean;
}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1023px)' ? isMobile : isTouch,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

describe('Sidebar context menu', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockNavigate.mockClear();
    mockOpenWindow.mockClear();
    mockOnClose.mockClear();
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true
    });
    mockMatchMedia({ isMobile: false, isTouch: false });
  });

  const renderSidebar = (initialRoute = '/', isOpen = true) => {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <WindowManagerProvider>
            <Sidebar isOpen={isOpen} onClose={mockOnClose} />
          </WindowManagerProvider>
        </MemoryRouter>
      </I18nextProvider>
    );
  };

  const contextMenuWindowCases = [
    { label: 'Console', windowType: 'console' },
    { label: 'Notes', windowType: 'notes' }
  ];

  it('shows context menu on right-click on desktop', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('does not show context menu on right-click on mobile', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('navigates when clicking Open in context menu', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    const openButton = screen.getByText('Open');
    await user.click(openButton);

    expect(mockNavigate).toHaveBeenCalledWith('/console');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it.each(
    contextMenuWindowCases
  )('opens window when clicking Open in Window for $label', async ({
    label,
    windowType
  }) => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const button = screen.getByRole('button', { name: label });
    await user.pointer({ keys: '[MouseRight]', target: button });

    const openInWindowButton = screen.getByText('Open in Window');
    await user.click(openInWindowButton);

    expect(mockOpenWindow).toHaveBeenCalledWith(windowType);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('does not show Open in Window for non-window paths', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    // Home is not in WINDOW_PATHS
    const homeButton = screen.getByRole('button', { name: 'Home' });
    await user.pointer({ keys: '[MouseRight]', target: homeButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('closes context menu when clicking overlay', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    expect(screen.getByText('Open')).toBeInTheDocument();

    // Click the overlay button that covers the background
    const closeOverlay = screen.getByRole('button', {
      name: 'Close context menu'
    });
    await user.click(closeOverlay);

    // Context menu should be closed
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('closes context menu when pressing Escape', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    expect(screen.getByText('Open')).toBeInTheDocument();

    // Press Escape to close the context menu
    await user.keyboard('{Escape}');

    // Context menu should be closed
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });
});
