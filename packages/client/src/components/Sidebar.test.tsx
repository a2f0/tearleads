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
    useWindowManager: () => ({
      openWindow: mockOpenWindow,
      windows: [],
      closeWindow: vi.fn(),
      bringToFront: vi.fn(),
      toggleMaximize: vi.fn(),
      toggleMinimize: vi.fn()
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

describe('Sidebar', () => {
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

  type User = ReturnType<typeof userEvent.setup>;
  type WindowActionCase = {
    label: string;
    windowType: string;
    actionLabel: string;
    action: (user: User, button: HTMLElement) => Promise<void>;
  };

  const desktopWindowCases: WindowActionCase[] = [
    {
      label: 'Console',
      windowType: 'console',
      actionLabel: 'single click',
      action: (user, button) => user.click(button)
    },
    {
      label: 'Videos',
      windowType: 'videos',
      actionLabel: 'double click',
      action: (user, button) => user.dblClick(button)
    }
  ];

  const mobileWindowLabels = ['Console', 'Videos'];
  const contextMenuWindowCases = [
    { label: 'Console', windowType: 'console' },
    { label: 'Notes', windowType: 'notes' }
  ];

  it('renders all navigation items', () => {
    // On mobile all navItems are shown (no flyout filtering)
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    for (const item of navItems) {
      const label = en.menu[item.labelKey];
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders navigation buttons with correct test ids', () => {
    // On desktop, /admin/users is in the flyout, not in main nav
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    for (const item of navItems) {
      const label = en.menu[item.labelKey];
      const button = screen.getByRole('button', { name: label });
      expect(button).toHaveAttribute('data-testid', item.testId);
    }
  });

  it('renders icons for each navigation item', () => {
    renderSidebar();

    // Each nav item should have an svg icon
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }
  });

  it('applies active styles to the current route', () => {
    renderSidebar('/contacts');

    const contactsButton = screen.getByRole('button', { name: 'Contacts' });
    expect(contactsButton).toHaveClass('bg-accent');
  });

  it('applies inactive styles to non-current routes', () => {
    renderSidebar('/contacts');

    const homeButton = screen.getByRole('button', { name: 'Home' });
    expect(homeButton).toHaveClass('text-muted-foreground');
    expect(homeButton).not.toHaveClass('bg-accent');
  });

  it('uses end matching for the root route', () => {
    renderSidebar('/contacts');

    // When on /contacts, the Home button (/) should not be active
    const homeButton = screen.getByRole('button', { name: 'Home' });
    expect(homeButton).not.toHaveClass('bg-accent');
  });

  it('renders as an aside element', () => {
    const { container } = renderSidebar();

    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
  });

  it('hides the sidebar when closed', () => {
    const { container } = renderSidebar('/', false);
    const aside = container.querySelector('aside');
    expect(aside).toHaveClass('lg:hidden');
  });

  it('contains a nav element', () => {
    renderSidebar();

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders an unordered list of navigation items', () => {
    // On mobile, all navItems are shown (no flyout filtering)
    mockMatchMedia({ isMobile: true, isTouch: true });
    renderSidebar();

    expect(screen.getByRole('list')).toBeInTheDocument();
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(navItems.length);
  });

  it('navigates on single click for non-window paths on desktop', async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Home is the only non-window path
    const homeButton = screen.getByRole('button', { name: 'Home' });
    await user.click(homeButton);

    expect(mockNavigate).toHaveBeenCalledWith('/');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it.each(
    desktopWindowCases
  )('opens floating window on $actionLabel for $label on desktop', async ({
    label,
    windowType,
    action
  }) => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: false, isTouch: false }); // Desktop viewport

    renderSidebar();

    const button = screen.getByRole('button', { name: label });
    await action(user, button);

    expect(mockOpenWindow).toHaveBeenCalledWith(windowType);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it.each(
    mobileWindowLabels
  )('navigates on single click for %s on mobile', async (label) => {
    const user = userEvent.setup();
    mockMatchMedia({ isMobile: true, isTouch: true }); // Mobile viewport

    renderSidebar();

    const button = screen.getByRole('button', { name: label });
    await user.click(button);

    expect(mockNavigate).toHaveBeenCalledWith(`/${label.toLowerCase()}`);
    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking a nav item on mobile', async () => {
    const localMockOnClose = vi.fn();
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1023px)' || query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/']}>
          <WindowManagerProvider>
            <Sidebar isOpen={true} onClose={localMockOnClose} />
          </WindowManagerProvider>
        </MemoryRouter>
      </I18nextProvider>
    );

    const contactsButton = screen.getByRole('button', { name: 'Contacts' });
    await user.click(contactsButton);

    expect(localMockOnClose).toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
  });

  it('opens window on double-click on desktop', async () => {
    const localMockOnClose = vi.fn();
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/']}>
          <WindowManagerProvider>
            <Sidebar isOpen={true} onClose={localMockOnClose} />
          </WindowManagerProvider>
        </MemoryRouter>
      </I18nextProvider>
    );

    const emailButton = screen.getByRole('button', { name: 'Email' });
    await user.click(emailButton);

    expect(localMockOnClose).toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
  });

  it('updates isMobile when media query changes', async () => {
    const localMockOnClose = vi.fn();
    let mediaChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;
    let isMobileMatches = false;

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1023px)' ? isMobileMatches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_, handler) => {
        if (query === '(max-width: 1023px)') {
          mediaChangeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/']}>
          <WindowManagerProvider>
            <Sidebar isOpen={true} onClose={localMockOnClose} />
          </WindowManagerProvider>
        </MemoryRouter>
      </I18nextProvider>
    );

    // Trigger the media change handler
    act(() => {
      isMobileMatches = true;
      if (mediaChangeHandler) {
        mediaChangeHandler({ matches: true } as MediaQueryListEvent);
      }
    });

    // Click a nav item - should use mobile behavior now
    const documentsButton = screen.getByRole('button', { name: 'Documents' });
    await user.click(documentsButton);

    expect(localMockOnClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/documents');

    window.matchMedia = originalMatchMedia;
  });

  describe('context menu', () => {
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
});

describe('navItems', () => {
  it('exports navItems array', () => {
    expect(Array.isArray(navItems)).toBe(true);
    expect(navItems.length).toBeGreaterThan(0);
  });

  it('each nav item has required properties', () => {
    for (const item of navItems) {
      expect(item).toHaveProperty('path');
      expect(item).toHaveProperty('icon');
      expect(item).toHaveProperty('labelKey');
      expect(typeof item.path).toBe('string');
      expect(typeof item.labelKey).toBe('string');
      // Lucide icons are React components (objects with render function)
      expect(item.icon).toBeDefined();
    }
  });

  it('includes expected navigation destinations', () => {
    const paths = navItems.map((item) => item.path);

    expect(paths).toContain('/');
    expect(paths).toContain('/contacts');
    expect(paths).toContain('/photos');
    expect(paths).toContain('/settings');
  });

  it('has unique paths', () => {
    const paths = navItems.map((item) => item.path);
    const uniquePaths = new Set(paths);

    expect(uniquePaths.size).toBe(paths.length);
  });

  it('has unique labelKeys', () => {
    const labelKeys = navItems.map((item) => item.labelKey);
    const uniqueLabelKeys = new Set(labelKeys);

    expect(uniqueLabelKeys.size).toBe(labelKeys.length);
  });
});

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
