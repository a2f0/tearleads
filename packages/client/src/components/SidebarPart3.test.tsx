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

describe('Admin flyout menu', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockNavigate.mockClear();
    mockOpenWindow.mockClear();
    mockOnClose.mockClear();
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true
    });
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

  it('shows flyout menu on desktop when hovering Admin', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    // Flyout should not be visible initially
    expect(screen.queryByTestId('admin-flyout-menu')).not.toBeInTheDocument();

    // Hover over admin button to show flyout
    const adminButton = screen.getByTestId('admin-link');
    await user.hover(adminButton);

    // Flyout should now be visible
    expect(screen.getByTestId('admin-flyout-menu')).toBeInTheDocument();
  });

  it('shows chevron icon on Admin button on desktop', () => {
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const adminButton = screen.getByTestId('admin-link');
    const chevron = adminButton.querySelector('svg.ml-auto');
    expect(chevron).toBeInTheDocument();
  });

  it('does not show chevron icon on Admin button on mobile', () => {
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    const adminButton = screen.getByTestId('admin-link');
    const chevron = adminButton.querySelector('svg.ml-auto');
    expect(chevron).not.toBeInTheDocument();
  });

  it('does not show flyout menu on mobile', () => {
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    expect(screen.queryByTestId('admin-flyout-menu')).not.toBeInTheDocument();
  });

  it('renders all five admin options in flyout on desktop', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    await user.hover(screen.getByTestId('admin-link'));

    expect(screen.getByTestId('admin-flyout-redis')).toBeInTheDocument();
    expect(screen.getByTestId('admin-flyout-postgres')).toBeInTheDocument();
    expect(screen.getByTestId('admin-flyout-groups')).toBeInTheDocument();
    expect(
      screen.getByTestId('admin-flyout-organizations')
    ).toBeInTheDocument();
    expect(screen.getByTestId('admin-flyout-adminUsers')).toBeInTheDocument();
  });

  it('flyout options have correct labels', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    await user.hover(screen.getByTestId('admin-link'));

    expect(screen.getByTestId('admin-flyout-redis')).toHaveTextContent('Redis');
    expect(screen.getByTestId('admin-flyout-postgres')).toHaveTextContent(
      'Postgres'
    );
    expect(screen.getByTestId('admin-flyout-groups')).toHaveTextContent(
      'Groups'
    );
    expect(screen.getByTestId('admin-flyout-organizations')).toHaveTextContent(
      'Organizations'
    );
    expect(screen.getByTestId('admin-flyout-adminUsers')).toHaveTextContent(
      'Users Admin'
    );
  });

  it('clicking flyout Redis option opens admin-redis window', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    // Use fireEvent for mouseEnter since userEvent.hover may not trigger onMouseEnter properly
    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');
    fireEvent.mouseEnter(adminLi);

    const redisButton = screen.getByTestId('admin-flyout-redis');
    await user.click(redisButton);

    expect(mockOpenWindow).toHaveBeenCalledWith('admin-redis');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('clicking flyout Postgres option opens admin-postgres window', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    // Use fireEvent for mouseEnter since userEvent.hover may not trigger onMouseEnter properly
    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');
    fireEvent.mouseEnter(adminLi);

    const postgresButton = screen.getByTestId('admin-flyout-postgres');
    await user.click(postgresButton);

    expect(mockOpenWindow).toHaveBeenCalledWith('admin-postgres');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('clicking flyout Groups option opens admin-groups window', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    // Use fireEvent for mouseEnter since userEvent.hover may not trigger onMouseEnter properly
    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');
    fireEvent.mouseEnter(adminLi);

    const groupsButton = screen.getByTestId('admin-flyout-groups');
    await user.click(groupsButton);

    expect(mockOpenWindow).toHaveBeenCalledWith('admin-groups');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('clicking flyout Users option opens admin-users window', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    // Use fireEvent for mouseEnter since userEvent.hover may not trigger onMouseEnter properly
    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');
    fireEvent.mouseEnter(adminLi);

    const usersButton = screen.getByTestId('admin-flyout-adminUsers');
    await user.click(usersButton);

    expect(mockOpenWindow).toHaveBeenCalledWith('admin-users');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('clicking flyout Organizations option opens admin-organizations window', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');
    fireEvent.mouseEnter(adminLi);

    const organizationsButton = screen.getByTestId(
      'admin-flyout-organizations'
    );
    await user.click(organizationsButton);

    expect(mockOpenWindow).toHaveBeenCalledWith('admin-organizations');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('Admin button has aria-haspopup on desktop', () => {
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const adminButton = screen.getByTestId('admin-link');
    expect(adminButton).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('Admin button does not have aria-haspopup on mobile', () => {
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    const adminButton = screen.getByTestId('admin-link');
    expect(adminButton).not.toHaveAttribute('aria-haspopup');
  });

  it('flyout menu has correct aria-label', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    await user.hover(screen.getByTestId('admin-link'));

    const flyoutMenu = screen.getByTestId('admin-flyout-menu');
    expect(flyoutMenu).toHaveAttribute('aria-label', 'Admin submenu');
  });

  it('flyout items have menuitem role', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    await user.hover(screen.getByTestId('admin-link'));

    const redisButton = screen.getByTestId('admin-flyout-redis');
    expect(redisButton).toHaveAttribute('role', 'menuitem');
  });

  it('highlights active flyout item when on admin/postgres route', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar('/admin/postgres');

    await user.hover(screen.getByTestId('admin-link'));

    const postgresButton = screen.getByTestId('admin-flyout-postgres');
    expect(postgresButton).toHaveClass('bg-accent');
  });

  it('highlights Admin button when any admin sub-route is active', () => {
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar('/admin/groups');

    const adminButton = screen.getByTestId('admin-link');
    expect(adminButton).toHaveClass('bg-accent');
  });

  it('filters out /admin/users and /admin/organizations from main nav on desktop', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    // The admin-users-link should not be in main nav on desktop
    // It should only appear in the flyout
    const mainNavButtons = screen
      .getAllByRole('listitem')
      .map((li) => li.querySelector('button[data-testid]'))
      .filter(Boolean);

    const adminUsersInMainNav = mainNavButtons.find(
      (btn) => btn?.getAttribute('data-testid') === 'admin-users-link'
    );
    expect(adminUsersInMainNav).toBeUndefined();
    const adminOrgsInMainNav = mainNavButtons.find(
      (btn) => btn?.getAttribute('data-testid') === 'admin-organizations-link'
    );
    expect(adminOrgsInMainNav).toBeUndefined();

    // But it should be in the flyout when hovered
    await user.hover(screen.getByTestId('admin-link'));
    expect(screen.getByTestId('admin-flyout-adminUsers')).toBeInTheDocument();
    expect(
      screen.getByTestId('admin-flyout-organizations')
    ).toBeInTheDocument();
  });

  it('shows /admin/users and /admin/organizations in main nav on mobile', () => {
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    expect(screen.getByTestId('admin-users-link')).toBeInTheDocument();
    expect(screen.getByTestId('admin-organizations-link')).toBeInTheDocument();
  });

  it('closes flyout when mouse leaves admin button', () => {
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');

    // Show flyout
    fireEvent.mouseEnter(adminLi);
    expect(screen.getByTestId('admin-flyout-menu')).toBeInTheDocument();

    // Hide flyout by mouse leave
    fireEvent.mouseLeave(adminLi);
    expect(screen.queryByTestId('admin-flyout-menu')).not.toBeInTheDocument();
  });

  it('keeps flyout open when mouse moves to flyout menu', () => {
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');

    // Show flyout
    fireEvent.mouseEnter(adminLi);
    const flyout = screen.getByTestId('admin-flyout-menu');
    expect(flyout).toBeInTheDocument();

    // Move mouse to flyout - should keep it open
    fireEvent.mouseEnter(flyout);
    expect(screen.getByTestId('admin-flyout-menu')).toBeInTheDocument();

    // Mouse leave from flyout - should close
    fireEvent.mouseLeave(flyout);
    expect(screen.queryByTestId('admin-flyout-menu')).not.toBeInTheDocument();
  });

  it('shows context menu on right-click on flyout item', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const adminLi = screen.getByTestId('admin-link').closest('li');
    if (!adminLi) throw new Error('Admin li not found');
    fireEvent.mouseEnter(adminLi);

    const postgresButton = screen.getByTestId('admin-flyout-postgres');
    await user.pointer({ keys: '[MouseRight]', target: postgresButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows context menu on right-click on Admin button', async () => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false });
    renderSidebar();

    const adminButton = screen.getByTestId('admin-link');
    await user.pointer({ keys: '[MouseRight]', target: adminButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });
});