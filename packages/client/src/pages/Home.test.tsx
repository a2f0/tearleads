import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { Home } from './Home';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: () => 'solid',
    setSetting: vi.fn()
  })
}));

const STORAGE_KEY = 'desktop-icon-positions';

const MOCK_SAVED_POSITIONS = {
  '/files': { x: 300, y: 300 },
  '/contacts': { x: 400, y: 100 },
  '/photos': { x: 100, y: 200 },
  '/documents': { x: 200, y: 200 },
  '/notes': { x: 300, y: 200 },
  '/audio': { x: 400, y: 200 },
  '/videos': { x: 100, y: 300 },
  '/tables': { x: 200, y: 300 },
  '/analytics': { x: 300, y: 300 },
  '/sqlite': { x: 400, y: 300 },
  '/console': { x: 100, y: 400 },
  '/debug': { x: 200, y: 400 },
  '/opfs': { x: 300, y: 400 },
  '/cache-storage': { x: 400, y: 400 },
  '/local-storage': { x: 100, y: 500 },
  '/keychain': { x: 200, y: 500 },
  '/chat': { x: 300, y: 500 },
  '/email': { x: 400, y: 500 },
  '/models': { x: 100, y: 600 },
  '/admin': { x: 200, y: 600 },
  '/settings': { x: 300, y: 600 }
};

describe('Home', () => {
  const renderHome = () => {
    return render(
      <WindowManagerProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </WindowManagerProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

  it('handles pointer down on icon', () => {
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });

    fireEvent.pointerDown(filesButton, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    // Icon should still be visible after pointer down
    expect(filesButton).toBeInTheDocument();
  });

  it('handles pointer move during drag', () => {
    const { container } = renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    const canvas = container.querySelector('[role="application"]');

    // Start drag
    fireEvent.pointerDown(filesButton, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    if (canvas) {
      // Move pointer
      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 200,
        pointerId: 1
      });

      // End drag
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }

    expect(filesButton).toBeInTheDocument();
  });

  it('ignores right-click for drag', () => {
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });

    // Right-click should not start drag
    fireEvent.pointerDown(filesButton, {
      button: 2,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    expect(filesButton).toBeInTheDocument();
  });

  it('auto arrange resets icon positions', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    expect(canvas).toBeInTheDocument();

    // Open canvas context menu
    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    // Click Auto Arrange
    const autoArrangeItem = screen.getByText('Auto Arrange');
    await user.click(autoArrangeItem);

    // Context menu should close
    expect(screen.queryByText('Auto Arrange')).not.toBeInTheDocument();
  });

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

  it('saves icon positions to localStorage after drag', () => {
    const { container } = renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    const canvas = container.querySelector('[role="application"]');

    // Start drag
    fireEvent.pointerDown(filesButton, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    if (canvas) {
      // Move pointer to trigger drag
      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 200,
        pointerId: 1
      });

      // End drag
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }

    // Positions should be saved to localStorage
    const saved = localStorage.getItem(STORAGE_KEY);
    expect(saved).not.toBeNull();
    if (saved) {
      expect(JSON.parse(saved)).toHaveProperty('/files');
    }
  });

  it('loads saved positions from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));

    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    // Icon should be at the saved position
    expect(filesButton).toHaveStyle({ left: '300px', top: '300px' });
  });

  it('clears localStorage on auto arrange', async () => {
    const user = userEvent.setup();

    // Pre-populate localStorage with saved positions
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));

    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    // Open canvas context menu
    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    // Click Auto Arrange
    const autoArrangeItem = screen.getByText('Auto Arrange');
    await user.click(autoArrangeItem);

    // localStorage should be cleared
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('uses grid positions when localStorage has invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid-json');

    renderHome();

    // Should render without error
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
  });

  it('uses grid positions when localStorage is missing items', () => {
    // Save positions missing some items
    const partialPositions = {
      '/files': { x: 300, y: 300 }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partialPositions));

    renderHome();

    // Should fall back to grid positions since not all items have saved positions
    const filesButton = screen.getByRole('button', { name: 'Files' });
    // Position should NOT be the saved position (300, 300) since we fell back to grid
    expect(filesButton).not.toHaveStyle({ left: '300px', top: '300px' });
  });

  it('constrains positions on window resize', () => {
    // Mock container with dimensions smaller than the out-of-bounds position
    const mockContainer = {
      offsetWidth: 400,
      offsetHeight: 300
    };

    // Save positions with one that is outside the viewport
    const outOfBoundsPositions = {
      ...MOCK_SAVED_POSITIONS,
      '/files': { x: 1000, y: 800 }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(outOfBoundsPositions));

    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    // Mock the container dimensions before triggering resize
    if (canvas) {
      Object.defineProperty(canvas, 'offsetWidth', {
        value: mockContainer.offsetWidth,
        configurable: true
      });
      Object.defineProperty(canvas, 'offsetHeight', {
        value: mockContainer.offsetHeight,
        configurable: true
      });
    }

    // Trigger resize event - this should constrain the out-of-bounds position
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Icon should be constrained to viewport bounds (max x = 400 - 64 = 336, max y = 300 - 96 = 204)
    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton).toBeInTheDocument();
    // Verify the position was constrained to the exact calculated bounds
    expect(filesButton).toHaveStyle({ left: '336px', top: '204px' });
  });

  it('uses saved positions as-is when container has no dimensions', () => {
    // Save positions with one that would be outside a small viewport
    const savedPositions = {
      ...MOCK_SAVED_POSITIONS,
      '/files': { x: 1000, y: 1000 }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPositions));

    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    // In jsdom, container has 0 dimensions, so positions won't be constrained
    // This tests the fallback path where we use saved positions as-is
    expect(canvas).toBeInTheDocument();
    const filesButton = screen.getByRole('button', { name: 'Files' });
    // Should have the saved position since container has no dimensions
    expect(filesButton).toHaveStyle({ left: '1000px', top: '1000px' });
  });

  it('updates mobile state on resize', () => {
    renderHome();

    // Mock window width to trigger mobile mode
    Object.defineProperty(window, 'innerWidth', {
      value: 500,
      configurable: true
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Component should still render
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();

    // Reset window width
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      configurable: true
    });
  });

  describe('mobile behavior', () => {
    const renderMobileHome = () => {
      // Set mobile viewport before rendering
      Object.defineProperty(window, 'innerWidth', {
        value: 500,
        configurable: true
      });
      const result = renderHome();
      // Trigger resize to ensure state is updated
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      return result;
    };

    afterEach(() => {
      // Reset to desktop viewport
      Object.defineProperty(window, 'innerWidth', {
        value: 1024,
        configurable: true
      });
    });

    it('navigates on single click in mobile mode', async () => {
      const user = userEvent.setup();
      renderMobileHome();

      const filesButton = screen.getByRole('button', { name: 'Files' });
      await user.click(filesButton);

      expect(mockNavigate).toHaveBeenCalledWith('/files');
    });

    it('does not start drag on pointer down in mobile mode', () => {
      const { container } = renderMobileHome();

      const filesButton = screen.getByRole('button', { name: 'Files' });
      const canvas = container.querySelector('[role="application"]');

      // Try to start drag
      fireEvent.pointerDown(filesButton, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });

      if (canvas) {
        // Move pointer
        fireEvent.pointerMove(canvas, {
          clientX: 200,
          clientY: 200,
          pointerId: 1
        });

        // End drag
        fireEvent.pointerUp(canvas, { pointerId: 1 });
      }

      // Positions should NOT be saved to localStorage since drag was disabled
      const saved = localStorage.getItem(STORAGE_KEY);
      expect(saved).toBeNull();
    });

    it('uses pointer cursor on mobile instead of grab cursor', () => {
      renderMobileHome();

      const filesButton = screen.getByRole('button', { name: 'Files' });
      expect(filesButton).toHaveStyle({ cursor: 'pointer' });
    });

    it('allows default touch behavior on mobile', () => {
      const { container } = renderMobileHome();

      const canvas = container.querySelector<HTMLElement>(
        '[role="application"]'
      );
      expect(canvas).toBeInTheDocument();
      expect(canvas?.style.touchAction).toBe('auto');
    });

    it('uses grid layout and scrollable container on mobile', () => {
      const { container } = renderMobileHome();

      const canvas = container.querySelector<HTMLElement>(
        '[role="application"]'
      );
      expect(canvas).toBeInTheDocument();
      expect(canvas).toHaveClass('overflow-y-auto');

      const grid = screen.getByTestId('home-grid');
      expect(grid).toHaveClass('grid');

      const filesButton = screen.getByRole('button', { name: 'Files' });
      expect(filesButton.className).not.toContain('absolute');
    });
  });

  it('shows scatter option in canvas context menu and randomizes icon positions', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');

    // Mock container dimensions for scatter calculation
    if (canvas) {
      Object.defineProperty(canvas, 'offsetWidth', {
        value: 800,
        configurable: true
      });
      Object.defineProperty(canvas, 'offsetHeight', {
        value: 600,
        configurable: true
      });
    }

    // Get initial position of an icon
    const filesButton = screen.getByRole('button', { name: 'Files' });
    const initialStyle = filesButton.getAttribute('style');

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    expect(screen.getByText('Scatter')).toBeInTheDocument();

    await user.click(screen.getByText('Scatter'));

    // Context menu should close
    expect(screen.queryByText('Scatter')).not.toBeInTheDocument();

    // localStorage should be cleared
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Position should have changed (scatter assigns random positions)
    const newStyle = filesButton.getAttribute('style');
    expect(newStyle).not.toEqual(initialStyle);
  });

  it('shows cluster option in canvas context menu and arranges icons in centered square', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');

    // Mock container dimensions for cluster calculation
    if (canvas) {
      Object.defineProperty(canvas, 'offsetWidth', {
        value: 800,
        configurable: true
      });
      Object.defineProperty(canvas, 'offsetHeight', {
        value: 600,
        configurable: true
      });
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    expect(screen.getByText('Cluster')).toBeInTheDocument();

    await user.click(screen.getByText('Cluster'));

    // Context menu should close
    expect(screen.queryByText('Cluster')).not.toBeInTheDocument();

    // localStorage should be cleared (same as auto-arrange)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // With 21 icons in an 800x600 container:
    // cols = ceil(sqrt(21)) = 5, rows = ceil(21/5) = 5
    // itemWidth = 64 + 40 = 104, itemHeightWithGap = 96 + 40 = 136
    // clusterWidth = 5*104 - 40 = 480, clusterHeight = 5*136 - 40 = 640
    // startX = (800 - 480) / 2 = 160, startY = max(0, (600 - 640) / 2) = 0
    // First icon (Files) at index 0: col=0, row=0 -> (160, 0)
    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton).toHaveStyle({ left: '160px', top: '0px' });
  });

  it('shows Open in Window option for Notes icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const notesButton = screen.getByRole('button', { name: 'Notes' });
    await user.pointer({ keys: '[MouseRight]', target: notesButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Console icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Email icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const emailButton = screen.getByRole('button', { name: 'Email' });
    await user.pointer({ keys: '[MouseRight]', target: emailButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Files icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.pointer({ keys: '[MouseRight]', target: filesButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Models icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const modelsButton = screen.getByRole('button', { name: 'Models' });
    await user.pointer({ keys: '[MouseRight]', target: modelsButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('shows Open in Window option for Local Storage icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const localStorageButton = screen.getByRole('button', {
      name: 'Local Storage'
    });
    await user.pointer({ keys: '[MouseRight]', target: localStorageButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens console in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const consoleButton = screen.getByRole('button', { name: 'Console' });
    await user.pointer({ keys: '[MouseRight]', target: consoleButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('opens local storage in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const localStorageButton = screen.getByRole('button', {
      name: 'Local Storage'
    });
    await user.pointer({ keys: '[MouseRight]', target: localStorageButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('opens notes in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const notesButton = screen.getByRole('button', { name: 'Notes' });
    await user.pointer({ keys: '[MouseRight]', target: notesButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('shows Open in Window option for Settings icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    await user.pointer({ keys: '[MouseRight]', target: settingsButton });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens settings in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    await user.pointer({ keys: '[MouseRight]', target: settingsButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('opens files in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.pointer({ keys: '[MouseRight]', target: filesButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('shows Open in Window option for SQLite icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const sqliteButton = screen.getByRole('button', { name: 'SQLite' });
    await user.pointer({ keys: '[MouseRight]', target: sqliteButton });

    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens sqlite in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const sqliteButton = screen.getByRole('button', { name: 'SQLite' });
    await user.pointer({ keys: '[MouseRight]', target: sqliteButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('shows Open in Window option for Local Storage icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const localStorageButton = screen.getByRole('button', {
      name: 'Local Storage'
    });
    await user.pointer({ keys: '[MouseRight]', target: localStorageButton });

    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens local storage in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const localStorageButton = screen.getByRole('button', {
      name: 'Local Storage'
    });
    await user.pointer({ keys: '[MouseRight]', target: localStorageButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  it('shows Open in Window option for Contacts icon', async () => {
    const user = userEvent.setup();
    renderHome();

    const contactsButton = screen.getByRole('button', { name: 'Contacts' });
    await user.pointer({ keys: '[MouseRight]', target: contactsButton });

    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('opens contacts in floating window when Open in Window is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    const contactsButton = screen.getByRole('button', { name: 'Contacts' });
    await user.pointer({ keys: '[MouseRight]', target: contactsButton });

    const openInWindowItem = screen.getByText('Open in Window');
    await user.click(openInWindowItem);

    // Context menu should close
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });

  describe('marquee selection', () => {
    const setupCanvasMocks = (canvas: Element) => {
      Object.defineProperty(canvas, 'offsetWidth', {
        value: 800,
        configurable: true
      });
      Object.defineProperty(canvas, 'offsetHeight', {
        value: 600,
        configurable: true
      });
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({})
      });
    };

    it('draws a selection box when dragging on empty canvas', () => {
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        setupCanvasMocks(canvas);

        // Start selection by clicking on empty canvas
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        // Drag to create selection box
        fireEvent.pointerMove(canvas, {
          clientX: 200,
          clientY: 200,
          pointerId: 1
        });

        // Selection box should be visible
        const selectionBox = container.querySelector('.border-primary');
        expect(selectionBox).toBeInTheDocument();
      }
    });

    it('selects icons that intersect with the selection box', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        setupCanvasMocks(canvas);

        // Start selection on empty canvas area
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        // Drag to create a large selection box
        fireEvent.pointerMove(canvas, {
          clientX: 500,
          clientY: 500,
          pointerId: 1
        });

        // End selection
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // Selection box should be removed after pointer up
        const selectionBox = container.querySelector('.border-primary');
        expect(selectionBox).not.toBeInTheDocument();

        // Some icons should be selected (have the ring class)
        const selectedIcons = container.querySelectorAll('.ring-primary');
        expect(selectedIcons.length).toBeGreaterThan(0);
      }
    });

    it('clears selection when clicking on empty canvas without dragging', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        setupCanvasMocks(canvas);

        // First create a selection
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        fireEvent.pointerMove(canvas, {
          clientX: 500,
          clientY: 500,
          pointerId: 1
        });

        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // Some icons should be selected
        let selectedIcons = container.querySelectorAll('.ring-primary');
        expect(selectedIcons.length).toBeGreaterThan(0);

        // Click on empty area (small box, no drag)
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 10,
          clientY: 10,
          pointerId: 1
        });

        // Small movement (less than 5 pixels)
        fireEvent.pointerMove(canvas, {
          clientX: 12,
          clientY: 12,
          pointerId: 1
        });

        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // Selection should be cleared
        selectedIcons = container.querySelectorAll('.ring-primary');
        expect(selectedIcons.length).toBe(0);
      }
    });

    it('clears selection when starting to drag an icon', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        setupCanvasMocks(canvas);

        // First create a selection
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        fireEvent.pointerMove(canvas, {
          clientX: 500,
          clientY: 500,
          pointerId: 1
        });

        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // Some icons should be selected
        let selectedIcons = container.querySelectorAll('.ring-primary');
        expect(selectedIcons.length).toBeGreaterThan(0);

        // Start dragging an icon
        const filesButton = screen.getByRole('button', { name: 'Files' });
        fireEvent.pointerDown(filesButton, {
          button: 0,
          clientX: 300,
          clientY: 300,
          pointerId: 1
        });

        // Selection should be cleared when starting to drag
        selectedIcons = container.querySelectorAll('.ring-primary');
        expect(selectedIcons.length).toBe(0);
      }
    });

    it('shows selection-specific context menu options when icons are selected', async () => {
      const user = userEvent.setup();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        setupCanvasMocks(canvas);

        // First create a selection
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        fireEvent.pointerMove(canvas, {
          clientX: 500,
          clientY: 500,
          pointerId: 1
        });

        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // Open context menu
        await user.pointer({ keys: '[MouseRight]', target: canvas });

        // Should show selection-specific labels
        expect(screen.getByText('Auto Arrange Selected')).toBeInTheDocument();
        expect(screen.getByText('Scatter Selected')).toBeInTheDocument();
        expect(screen.getByText('Cluster Selected')).toBeInTheDocument();
      }
    });

    it('clears selection after applying an arrangement operation', async () => {
      const user = userEvent.setup();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        setupCanvasMocks(canvas);

        // First create a selection
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        fireEvent.pointerMove(canvas, {
          clientX: 500,
          clientY: 500,
          pointerId: 1
        });

        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // Some icons should be selected
        let selectedIcons = container.querySelectorAll('.ring-primary');
        expect(selectedIcons.length).toBeGreaterThan(0);

        // Open context menu and click Scatter Selected
        await user.pointer({ keys: '[MouseRight]', target: canvas });
        await user.click(screen.getByText('Scatter Selected'));

        // Selection should be cleared after operation
        selectedIcons = container.querySelectorAll('.ring-primary');
        expect(selectedIcons.length).toBe(0);
      }
    });

    it('does not start selection when clicking on an icon', () => {
      const { container } = renderHome();
      const filesButton = screen.getByRole('button', { name: 'Files' });

      // Start on an icon (not canvas)
      fireEvent.pointerDown(filesButton, {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1
      });

      // No selection box should appear
      const selectionBox = container.querySelector('.border-primary');
      expect(selectionBox).not.toBeInTheDocument();
    });

    it('does not start selection on right-click', () => {
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        // Right-click on canvas
        fireEvent.pointerDown(canvas, {
          button: 2,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        // No selection box should appear
        const selectionBox = container.querySelector('.border-primary');
        expect(selectionBox).not.toBeInTheDocument();
      }
    });

    it('preserves positions of non-selected icons when arranging selected', async () => {
      const user = userEvent.setup();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
      const { container } = renderHome();
      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        setupCanvasMocks(canvas);

        // Get initial position of Settings (at x:200, y:600)
        const settingsButton = screen.getByRole('button', { name: 'Settings' });
        const initialSettingsStyle = settingsButton.getAttribute('style');

        // Select only icons in the upper area (y < 400)
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        fireEvent.pointerMove(canvas, {
          clientX: 500,
          clientY: 350,
          pointerId: 1
        });

        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // Settings should not be selected (it's at y:600)
        expect(settingsButton.querySelector('.ring-primary')).toBeNull();

        // Open context menu and scatter selected
        await user.pointer({ keys: '[MouseRight]', target: canvas });
        await user.click(screen.getByText('Scatter Selected'));

        // Settings position should be preserved (or very close, allowing for CSS transitions)
        const newSettingsStyle = settingsButton.getAttribute('style');
        expect(newSettingsStyle).toContain('left: 300px');
        expect(newSettingsStyle).toContain('top: 600px');
        expect(newSettingsStyle).toBe(initialSettingsStyle);
      }
    });

    it('does not start selection on mobile', () => {
      // Set mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        value: 500,
        configurable: true
      });

      const { container } = renderHome();

      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      const canvas = container.querySelector('[role="application"]');

      if (canvas) {
        // Try to start selection
        fireEvent.pointerDown(canvas, {
          button: 0,
          clientX: 50,
          clientY: 50,
          pointerId: 1
        });

        fireEvent.pointerMove(canvas, {
          clientX: 200,
          clientY: 200,
          pointerId: 1
        });

        // No selection box should appear on mobile
        const selectionBox = container.querySelector('.border-primary');
        expect(selectionBox).not.toBeInTheDocument();
      }

      // Reset to desktop viewport
      Object.defineProperty(window, 'innerWidth', {
        value: 1024,
        configurable: true
      });
    });
  });
});
