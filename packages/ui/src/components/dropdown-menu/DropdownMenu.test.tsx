import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenu, useDropdownMenuContext } from './DropdownMenu';
import { DropdownMenuItem } from './DropdownMenuItem';

describe('DropdownMenu', () => {
  it('renders trigger button and opens menu', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'New' })).toBeInTheDocument();
  });

  it('closes when clicking outside or pressing Escape', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <DropdownMenu trigger="File">
          <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
        </DropdownMenu>
        <button type="button">Outside</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('button', { name: 'Outside' }));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('closes on item click unless preventClose is set', async () => {
    const user = userEvent.setup();
    const keepOpen = vi.fn();
    const closeMenu = vi.fn();

    render(
      <DropdownMenu trigger="Edit">
        <DropdownMenuItem onClick={keepOpen} preventClose>
          Keep Open
        </DropdownMenuItem>
        <DropdownMenuItem onClick={closeMenu}>Close</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('menuitem', { name: 'Keep Open' }));

    expect(keepOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(closeMenu).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('supports left and right alignment', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menu')).toHaveAttribute('data-align', 'left');

    rerender(
      <DropdownMenu trigger="File" align="right">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    const trigger = screen.getByRole('button', { name: 'File' });
    if (trigger.getAttribute('aria-expanded') === 'true') {
      await user.click(trigger);
    }
    await user.click(trigger);
    expect(screen.getByRole('menu')).toHaveAttribute('data-align', 'right');
  });

  it('supports keyboard navigation (ArrowUp/ArrowDown/Home/End)', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="View">
        <DropdownMenuItem onClick={vi.fn()}>One</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Two</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Three</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'View' }));

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
  });

  it('supports custom trigger element and preserves trigger onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <DropdownMenu
        trigger={
          <button type="button" onClick={onClick}>
            Tools
          </button>
        }
      >
        <DropdownMenuItem onClick={vi.fn()}>Action</DropdownMenuItem>
      </DropdownMenu>
    );

    const trigger = screen.getByRole('button', { name: 'Tools' });
    await user.click(trigger);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps non-clickable children and exposes dropdown context', async () => {
    const user = userEvent.setup();
    const closeViaContext = vi.fn();
    const readContainerViaContext = vi.fn();

    function ContextConsumer() {
      const context = useDropdownMenuContext();
      return (
        <button
          type="button"
          onClick={() => {
            if (context) {
              readContainerViaContext(context.getContainerElement());
              context.close();
              closeViaContext();
            }
          }}
        >
          Close From Context
        </button>
      );
    }

    render(
      <DropdownMenu trigger="Context">
        <DropdownMenuItem onClick={vi.fn()}>Action</DropdownMenuItem>
        <div data-testid="static-child">Static Child</div>
        <ContextConsumer />
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'Context' }));
    expect(screen.getByTestId('static-child')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Close From Context' })
    );

    expect(closeViaContext).toHaveBeenCalledTimes(1);
    expect(readContainerViaContext).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('renders non-element children in the menu', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="Raw">
        {'Plain Text Child'}
        <DropdownMenuItem onClick={vi.fn()}>Action</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('Plain Text Child')).toBeInTheDocument();
  });
});
