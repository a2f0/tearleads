import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenu } from './DropdownMenu';
import { DropdownMenuItem } from './DropdownMenuItem';

describe('DropdownMenu', () => {
  it('renders trigger button', () => {
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows menu when trigger is clicked', async () => {
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

  it('hides menu when clicking outside', async () => {
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
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outside' }));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('closes menu when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('closes menu when menu item is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClick}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New' }));

    expect(onClick).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('supports right alignment', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File" align="right">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    const menu = screen.getByRole('menu');

    expect(menu).toHaveClass('right-0');
    expect(menu).not.toHaveClass('left-0');
  });

  it('supports left alignment by default', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    const menu = screen.getByRole('menu');

    expect(menu).toHaveClass('left-0');
    expect(menu).not.toHaveClass('right-0');
  });

  it('navigates menu items with ArrowDown key', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Open</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Close</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'New' })).toHaveFocus();
    });
  });

  it('navigates menu items with ArrowUp key', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Open</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('{ArrowUp}');

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
    });
  });

  it('navigates to first item with Home key', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Open</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Close</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('{Home}');

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'New' })).toHaveFocus();
    });
  });

  it('navigates to last item with End key', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Open</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Close</DropdownMenuItem>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('{End}');

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Close' })).toHaveFocus();
    });
  });
});
