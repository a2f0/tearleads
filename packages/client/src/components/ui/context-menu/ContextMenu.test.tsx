import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FloatingWindow } from '@/components/floating-window';
import { ContextMenu } from './ContextMenu';
import { ContextMenuItem } from './ContextMenuItem';

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

  it('renders above floating windows', () => {
    render(
      <>
        <FloatingWindow id="test" title="Test" onClose={() => {}} zIndex={200}>
          <div>Window content</div>
        </FloatingWindow>
        <ContextMenu x={100} y={200} onClose={() => {}}>
          <div>Menu content</div>
        </ContextMenu>
      </>
    );

    const floatingWindow = screen.getByRole('dialog', { name: 'Test' });
    expect(floatingWindow).toHaveStyle({ zIndex: '200' });

    const overlay = screen.getByRole('button', {
      name: /close context menu/i
    }).parentElement;
    const menu = screen.getByText('Menu content').parentElement;
    const windowZIndex = Number.parseInt(floatingWindow.style.zIndex, 10);

    if (!overlay || !menu) {
      throw new Error('Missing context menu elements');
    }

    const overlayZIndex = Number.parseInt(
      window.getComputedStyle(overlay).zIndex,
      10
    );
    const menuZIndex = Number.parseInt(
      window.getComputedStyle(menu).zIndex,
      10
    );

    expect(overlayZIndex).toBeGreaterThan(windowZIndex);
    expect(menuZIndex).toBeGreaterThan(windowZIndex);
  });

  it('adjusts horizontal position when menu would overflow right edge', async () => {
    // Mock viewport width
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true
    });

    // Mock getBoundingClientRect to return a menu that would overflow
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => {
      // Return dimensions that would cause overflow at x=450 with viewport 500
      return {
        width: 160, // min-w-40 = 160px
        height: 40,
        top: 100,
        left: 450,
        right: 610,
        bottom: 140,
        x: 450,
        y: 100,
        toJSON: () => ({})
      };
    };

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
      expect(style).not.toContain('left: 450px');
      const leftValue = style
        ? parseFloat(style.match(/left: ([\d.]+)px/)?.[1] ?? '450')
        : 450;
      expect(leftValue).toBeLessThan(450);
    });

    // Restore original
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('adjusts vertical position when menu would overflow bottom edge', async () => {
    // Mock viewport dimensions
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
    Object.defineProperty(window, 'innerHeight', {
      value: 500,
      writable: true
    });

    // Mock getBoundingClientRect to return a menu that would overflow
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => {
      // Return dimensions that would cause overflow at y=450 with viewport 500
      return {
        width: 160,
        height: 100, // Height that causes overflow
        top: 450,
        left: 100,
        right: 260,
        bottom: 550,
        x: 100,
        y: 450,
        toJSON: () => ({})
      };
    };

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
      expect(style).not.toContain('top: 450px');
      const topValue = style
        ? parseFloat(style.match(/top: ([\d.]+)px/)?.[1] ?? '450')
        : 450;
      expect(topValue).toBeLessThan(450);
    });

    // Restore original
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
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

  it('does not call onClose for other keys', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ContextMenu x={100} y={200} onClose={onClose}>
        <div>Menu content</div>
      </ContextMenu>
    );

    await user.keyboard('{Enter}');

    expect(onClose).not.toHaveBeenCalled();
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
