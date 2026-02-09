import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WindowContextMenu } from './WindowContextMenu.js';

describe('WindowContextMenu', () => {
  it('renders with provided position', () => {
    render(
      <WindowContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        menuTestId="window-context-menu"
      >
        <button type="button">Item</button>
      </WindowContextMenu>
    );

    const menu = screen.getByTestId('window-context-menu');
    expect(menu).toHaveStyle({ left: '100px', top: '200px' });
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <WindowContextMenu
        x={100}
        y={200}
        onClose={onClose}
        backdropTestId="window-context-menu-backdrop"
      >
        <button type="button">Item</button>
      </WindowContextMenu>
    );

    await user.click(screen.getByTestId('window-context-menu-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps backdrop out of tab order', () => {
    render(
      <WindowContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        backdropTestId="window-context-menu-backdrop"
      >
        <button type="button">Item</button>
      </WindowContextMenu>
    );

    expect(screen.getByTestId('window-context-menu-backdrop')).toHaveAttribute(
      'tabindex',
      '-1'
    );
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <WindowContextMenu x={100} y={200} onClose={onClose}>
        <button type="button">Item</button>
      </WindowContextMenu>
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('repositions to stay within viewport bounds', () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => DOMRect.fromRect({ width: 120, height: 120 }));

    try {
      Object.defineProperty(window, 'innerWidth', {
        value: 200,
        configurable: true
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 200,
        configurable: true
      });

      render(
        <WindowContextMenu x={190} y={190} onClose={vi.fn()} menuTestId="menu">
          <button type="button">Item</button>
        </WindowContextMenu>
      );

      const menu = screen.getByTestId('menu');
      expect(menu).toHaveStyle({ left: '72px', top: '72px' });
    } finally {
      getBoundingClientRectSpy.mockRestore();
      Object.defineProperty(window, 'innerWidth', {
        value: originalInnerWidth,
        configurable: true
      });
      Object.defineProperty(window, 'innerHeight', {
        value: originalInnerHeight,
        configurable: true
      });
    }
  });
});
