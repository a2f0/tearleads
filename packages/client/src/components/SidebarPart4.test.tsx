import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { i18n } from '@/i18n';
import { en } from '@/i18n/translations/en';
import { navItems, Sidebar } from './Sidebar';

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

describe('Debug flyout menu', () => {
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

  it('shows flyout menu on desktop when hovering Debug', async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.queryByTestId('debug-flyout-menu')).not.toBeInTheDocument();

    await user.hover(screen.getByTestId('debug-link'));
    expect(screen.getByTestId('debug-flyout-menu')).toBeInTheDocument();
  });

  it('renders all debug flyout options', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.hover(screen.getByTestId('debug-link'));

    expect(screen.getByTestId('debug-flyout-systemInfo')).toHaveTextContent(
      'System Info'
    );
    expect(screen.getByTestId('debug-flyout-localStorage')).toHaveTextContent(
      'Local Storage'
    );
    expect(screen.getByTestId('debug-flyout-opfs')).toHaveTextContent('OPFS');
    expect(screen.getByTestId('debug-flyout-cacheStorage')).toHaveTextContent(
      'Cache Storage'
    );
  });

  it('clicking OPFS flyout option opens opfs window', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const debugLi = screen.getByTestId('debug-link').closest('li');
    if (!debugLi) throw new Error('Debug li not found');
    fireEvent.mouseEnter(debugLi);

    await user.click(screen.getByTestId('debug-flyout-opfs'));

    expect(mockOpenWindow).toHaveBeenCalledWith('opfs');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('highlights Debug button when debug sub-route is active', () => {
    renderSidebar('/debug/browser/cache-storage');

    expect(screen.getByTestId('debug-link')).toHaveClass('bg-accent');
  });

  it('flyout menu has correct aria-label', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.hover(screen.getByTestId('debug-link'));
    expect(screen.getByTestId('debug-flyout-menu')).toHaveAttribute(
      'aria-label',
      'Debug submenu'
    );
  });
});