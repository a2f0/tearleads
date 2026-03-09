import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_CONTEXT_MENU_OVERLAY_Z_INDEX,
  DESKTOP_CONTEXT_MENU_Z_INDEX,
  DesktopContextMenu
} from './DesktopContextMenu.js';

describe('DesktopContextMenu', () => {
  it('applies desktop z-index defaults and menu classes', () => {
    render(
      <DesktopContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        menuTestId="desktop-context-menu"
        backdropTestId="desktop-context-menu-backdrop"
      >
        <div>item</div>
      </DesktopContextMenu>
    );

    const menu = screen.getByTestId('desktop-context-menu');
    const backdrop = screen.getByTestId('desktop-context-menu-backdrop');

    expect(menu).toHaveStyle({
      left: '100px',
      top: '200px',
      zIndex: `${DESKTOP_CONTEXT_MENU_Z_INDEX}`
    });
    expect(menu).toHaveClass(
      'min-w-40',
      'bg-background',
      'py-1',
      'shadow-lg'
    );
    expect(backdrop).toHaveStyle({
      zIndex: `${DESKTOP_CONTEXT_MENU_OVERLAY_Z_INDEX}`
    });
  });

  it('allows overriding menuClassName', () => {
    render(
      <DesktopContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        menuClassName="custom-menu"
        menuTestId="desktop-context-menu"
      >
        <div>item</div>
      </DesktopContextMenu>
    );

    expect(screen.getByTestId('desktop-context-menu')).toHaveClass(
      'custom-menu'
    );
  });
});
