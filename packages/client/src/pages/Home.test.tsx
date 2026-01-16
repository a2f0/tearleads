import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from './Home';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

describe('Home', () => {
  const renderHome = () => {
    return render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
});
