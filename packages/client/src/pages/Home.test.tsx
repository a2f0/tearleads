import { ThemeProvider } from '@tearleads/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import {
  mockActivateScreensaver,
  setupScreensaverMock
} from '@/test/screensaverMock';
import { Home } from './Home';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockGetSetting = vi.fn();

vi.mock('@tearleads/settings', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: vi.fn()
  })
}));

setupScreensaverMock();

describe('Home', () => {
  const renderHome = () => {
    return render(
      <ThemeProvider>
        <WindowManagerProvider>
          <MemoryRouter>
            <Home />
          </MemoryRouter>
        </WindowManagerProvider>
      </ThemeProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetSetting.mockImplementation((key: string) => {
      switch (key) {
        case 'desktopPattern':
          return 'solid';
        case 'desktopIconDepth':
          return 'debossed';
        case 'desktopIconBackground':
          return 'colored';
        default:
          return 'enabled';
      }
    });
    // Mock setPointerCapture since jsdom doesn't support it
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('renders app icons for navigation items', () => {
    renderHome();

    // Should have buttons for the main app pages (double-click to open)
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Contacts' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Photos' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Settings' })
    ).toBeInTheDocument();
  });

  it('does not include Home button (self-reference)', () => {
    renderHome();

    // Should not have a button for Home since we're on Home
    const homeButtons = screen.queryAllByRole('button', { name: 'Home' });
    expect(homeButtons).toHaveLength(0);
  });

  it('renders icons for each app', () => {
    renderHome();

    // Each button should contain an SVG icon
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }
  });

  it('inverts icon colors when debossed is active', () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'desktopPattern') return 'solid';
      if (key === 'desktopIconBackground') return 'colored';
      return 'debossed';
    });
    renderHome();

    const assertIconDebossedColors = (
      name: string,
      expectedFromClass: string,
      expectedIconClass: string
    ) => {
      const button = screen.getByRole('button', { name });
      const wrapper = button.querySelector('div');
      const icon = button.querySelector('svg');
      expect(wrapper).toHaveClass(
        'bg-primary-foreground',
        expectedFromClass,
        'to-primary-foreground'
      );
      expect(icon).toHaveClass(expectedIconClass);
    };

    assertIconDebossedColors(
      'Files',
      'from-primary-foreground/80',
      'text-primary'
    );
    assertIconDebossedColors(
      'Settings',
      'from-primary-foreground/80',
      'text-primary'
    );
  });

  it('renders transparent icon backgrounds when enabled', () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'desktopPattern') return 'solid';
      if (key === 'desktopIconDepth') return 'debossed';
      if (key === 'desktopIconBackground') return 'transparent';
      return 'enabled';
    });
    renderHome();

    const button = screen.getByRole('button', { name: 'Files' });
    const wrapper = button.querySelector('div');
    const icon = button.querySelector('svg');

    expect(wrapper).toHaveClass('bg-transparent');
    expect(wrapper).not.toHaveClass('bg-primary');
    expect(wrapper).not.toHaveClass('bg-primary-foreground');
    expect(wrapper).not.toHaveClass('bg-muted-foreground');
    expect(icon).toHaveClass('text-foreground');
  });

  it('renders matching embossed icon colors for files and settings', () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'desktopPattern') return 'solid';
      if (key === 'desktopIconDepth') return 'embossed';
      if (key === 'desktopIconBackground') return 'colored';
      return 'enabled';
    });
    renderHome();

    const assertIconEmbossedColors = (name: string) => {
      const button = screen.getByRole('button', { name });
      const wrapper = button.querySelector('div');
      const icon = button.querySelector('svg');

      expect(wrapper).toHaveClass(
        'bg-primary',
        'from-primary/80',
        'to-primary'
      );
      expect(icon).toHaveClass('text-primary-foreground');
    };

    assertIconEmbossedColors('Files');
    assertIconEmbossedColors('Settings');
  });

  it('renders with canvas layout for draggable icons', () => {
    const { container } = renderHome();

    // Should have a relative container for absolute-positioned icons
    const canvas = container.querySelector('.relative');
    expect(canvas).toBeInTheDocument();

    // Icons should be absolutely positioned
    const icons = container.querySelectorAll('.absolute');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('opens floating window on double-click for Documents icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const documentsButton = screen.getByRole('button', { name: 'Documents' });
    await user.dblClick(documentsButton);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens floating window on double-click for Notes icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const notesButton = screen.getByRole('button', { name: 'Notes' });
    await user.dblClick(notesButton);

    // Should NOT navigate when double-clicking Notes
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens floating window on double-click for Console icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.dblClick(consoleButton);

    // Should NOT navigate when double-clicking Console
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates on Enter key press', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    filesButton.focus();
    await user.keyboard('{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith('/files');
  });

  it('shows canvas context menu on right-click', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    expect(canvas).toBeInTheDocument();

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    expect(screen.getByText('Auto Arrange')).toBeInTheDocument();
  });

  it('puts display properties above arrangement options', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    expect(canvas).toBeInTheDocument();

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    const menuContainer = screen.getByRole('button', {
      name: 'Auto Arrange'
    }).parentElement;
    expect(menuContainer).not.toBeNull();

    if (menuContainer) {
      expect(within(menuContainer).getByRole('separator')).toBeInTheDocument();

      const labels = within(menuContainer)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim() ?? '');
      expect(labels).toEqual([
        'Display Properties',
        'Start Screensaver',
        'Auto Arrange',
        'Cluster',
        'Scatter'
      ]);
    }
  });

  it('starts screensaver from canvas context menu', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    expect(canvas).toBeInTheDocument();

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    await user.click(screen.getByText('Start Screensaver'));

    expect(mockActivateScreensaver).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Start Screensaver')).not.toBeInTheDocument();
  });

  it('shows icon context menu on right-click', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.pointer({ keys: '[MouseRight]', target: filesButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('opens app from icon context menu', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.pointer({ keys: '[MouseRight]', target: filesButton });

    const openMenuItem = screen.getByText('Open');
    await user.click(openMenuItem);

    expect(mockNavigate).toHaveBeenCalledWith('/files');
  });

  // Drag and pointer tests moved to Home.drag.test.tsx
  // Auto arrange tests moved to Home.arrangement.test.tsx

  it('closes canvas context menu on close', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    expect(screen.getByText('Auto Arrange')).toBeInTheDocument();

    // Press Escape to close
    await user.keyboard('{Escape}');

    expect(screen.queryByText('Auto Arrange')).not.toBeInTheDocument();
  });

  it('closes icon context menu on close', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.pointer({ keys: '[MouseRight]', target: filesButton });

    expect(screen.getByText('Open')).toBeInTheDocument();

    // Press Escape to close
    await user.keyboard('{Escape}');

    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  // Position persistence tests moved to Home.drag.test.tsx

  // Mobile behavior tests moved to Home.mobile.test.tsx

  // Scatter, cluster tests moved to Home.arrangement.test.tsx

  // Open in Window tests moved to Home.window.test.tsx

  // Marquee selection tests moved to Home.marquee.test.tsx
});

// resolveOverlaps tests are in homeIconUtils.test.ts
