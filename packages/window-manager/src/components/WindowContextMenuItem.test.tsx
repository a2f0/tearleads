import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WindowContextMenuItem } from './WindowContextMenuItem.js';

describe('WindowContextMenuItem', () => {
  it('calls onClick when selected', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<WindowContextMenuItem onClick={onClick}>Open</WindowContextMenuItem>);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies destructive variant styles', () => {
    render(
      <WindowContextMenuItem variant="destructive" onClick={vi.fn()}>
        Delete
      </WindowContextMenuItem>
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
      'text-destructive',
      'hover:bg-destructive'
    );
  });

  it('supports disabled state', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <WindowContextMenuItem disabled onClick={onClick}>
        Disabled
      </WindowContextMenuItem>
    );

    const item = screen.getByRole('button', { name: 'Disabled' });
    expect(item).toBeDisabled();
    await user.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });
});
