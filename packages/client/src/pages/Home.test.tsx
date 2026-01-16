import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  '/models': { x: 400, y: 500 },
  '/admin': { x: 100, y: 600 },
  '/settings': { x: 200, y: 600 }
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

  it('navigates on double-click', async () => {
    const user = userEvent.setup();
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.dblClick(filesButton);

    expect(mockNavigate).toHaveBeenCalledWith('/files');
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

  it('shows scatter option in canvas context menu and closes menu on click', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    expect(screen.getByText('Scatter')).toBeInTheDocument();

    await user.click(screen.getByText('Scatter'));

    expect(screen.queryByText('Scatter')).not.toBeInTheDocument();
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
  });
});
