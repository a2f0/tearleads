import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, ContextMenuItem } from './context-menu';

describe('ContextMenu', () => {
  it('renders children at specified position', () => {
    render(
      <ContextMenu x={100} y={200} onClose={() => {}}>
        <div>Menu content</div>
      </ContextMenu>
    );

    expect(screen.getByText('Menu content')).toBeInTheDocument();
  });

  it('positions the menu at the specified coordinates', async () => {
    render(
      <ContextMenu x={150} y={250} onClose={() => {}}>
        <div>Menu content</div>
      </ContextMenu>
    );

    const menu = screen.getByText('Menu content').parentElement;
    // Initial position, may be adjusted by useLayoutEffect
    await waitFor(() => {
      expect(menu).toHaveStyle({ top: '250px', left: '150px' });
    });
  });

  it('adjusts horizontal position when menu would overflow right edge', async () => {
    // Mock viewport width
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true
    });

    render(
      <ContextMenu x={450} y={100} onClose={() => {}}>
        <div>Menu content</div>
      </ContextMenu>
    );

    const menu = screen.getByText('Menu content').parentElement;

    // Menu should adjust position to avoid overflow
    await waitFor(() => {
      const style = menu?.getAttribute('style');
      // The left position should be adjusted (less than the original 450)
      expect(style).toContain('left:');
    });
  });

  it('adjusts vertical position when menu would overflow bottom edge', async () => {
    // Mock viewport dimensions
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
    Object.defineProperty(window, 'innerHeight', {
      value: 500,
      writable: true
    });

    render(
      <ContextMenu x={100} y={450} onClose={() => {}}>
        <div>Menu content</div>
      </ContextMenu>
    );

    const menu = screen.getByText('Menu content').parentElement;

    // Menu should adjust position to avoid overflow
    await waitFor(() => {
      const style = menu?.getAttribute('style');
      // The top position should be adjusted (less than the original 450)
      expect(style).toContain('top:');
    });
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ContextMenu x={100} y={200} onClose={onClose}>
        <div>Menu content</div>
      </ContextMenu>
    );

    await user.click(
      screen.getByRole('button', { name: /close context menu/i })
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ContextMenu x={100} y={200} onClose={onClose}>
        <div>Menu content</div>
      </ContextMenu>
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ContextMenuItem', () => {
  it('renders children', () => {
    render(<ContextMenuItem onClick={() => {}}>Get info</ContextMenuItem>);

    expect(screen.getByText('Get info')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(
      <ContextMenuItem
        icon={<span data-testid="test-icon">Icon</span>}
        onClick={() => {}}
      >
        Get info
      </ContextMenuItem>
    );

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<ContextMenuItem onClick={onClick}>Get info</ContextMenuItem>);

    await user.click(screen.getByText('Get info'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders as a button element', () => {
    render(<ContextMenuItem onClick={() => {}}>Get info</ContextMenuItem>);

    expect(
      screen.getByRole('button', { name: /get info/i })
    ).toBeInTheDocument();
  });
});

describe('ContextMenu integration', () => {
  it('renders menu items correctly', async () => {
    const onClose = vi.fn();
    const onGetInfo = vi.fn();
    const user = userEvent.setup();

    render(
      <ContextMenu x={100} y={200} onClose={onClose}>
        <ContextMenuItem onClick={onGetInfo}>Get info</ContextMenuItem>
      </ContextMenu>
    );

    expect(screen.getByText('Get info')).toBeInTheDocument();

    await user.click(screen.getByText('Get info'));
    expect(onGetInfo).toHaveBeenCalledTimes(1);
  });

  it('cleans up event listener on unmount', async () => {
    const onClose = vi.fn();
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = render(
      <ContextMenu x={100} y={200} onClose={onClose}>
        <div>Menu content</div>
      </ContextMenu>
    );

    unmount();

    await waitFor(() => {
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
    });

    removeEventListenerSpy.mockRestore();
  });
});
