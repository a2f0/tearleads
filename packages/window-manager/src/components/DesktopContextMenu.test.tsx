import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_CONTEXT_MENU_OVERLAY_Z_INDEX,
  DESKTOP_CONTEXT_MENU_Z_INDEX,
  DesktopContextMenu
} from './DesktopContextMenu.js';
import type { WindowContextMenuProps } from './WindowContextMenu.js';

const renderedProps: WindowContextMenuProps[] = [];

vi.mock('./WindowContextMenu.js', () => ({
  WindowContextMenu: (props: WindowContextMenuProps) => {
    renderedProps.push(props);
    return <div data-testid="window-context-menu">{props.children}</div>;
  }
}));

describe('DesktopContextMenu', () => {
  beforeEach(() => {
    renderedProps.length = 0;
  });

  it('applies desktop z-index defaults and menu classes', () => {
    render(
      <DesktopContextMenu x={100} y={200} onClose={vi.fn()}>
        <div>item</div>
      </DesktopContextMenu>
    );

    expect(renderedProps).toHaveLength(1);
    expect(renderedProps[0]?.overlayZIndex).toBe(
      DESKTOP_CONTEXT_MENU_OVERLAY_Z_INDEX
    );
    expect(renderedProps[0]?.menuZIndex).toBe(DESKTOP_CONTEXT_MENU_Z_INDEX);
    expect(renderedProps[0]?.menuClassName).toBe(
      'min-w-40 bg-background py-1 shadow-lg'
    );
  });

  it('allows overriding menuClassName', () => {
    render(
      <DesktopContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        menuClassName="custom-menu"
      >
        <div>item</div>
      </DesktopContextMenu>
    );

    expect(renderedProps).toHaveLength(1);
    expect(renderedProps[0]?.menuClassName).toBe('custom-menu');
  });
});
