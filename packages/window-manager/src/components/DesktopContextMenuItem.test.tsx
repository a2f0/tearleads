import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DesktopContextMenuItem } from './DesktopContextMenuItem.js';

describe('DesktopContextMenuItem', () => {
  it('uses desktop item styling and handles click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <DesktopContextMenuItem onClick={onClick}>Open</DesktopContextMenuItem>
    );

    const item = screen.getByRole('button', { name: 'Open' });
    expect(item).toHaveClass('rounded-none');
    expect(item).toHaveClass('px-3');
    expect(item).toHaveClass('text-left');

    await user.click(item);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('merges additional class names', () => {
    render(
      <DesktopContextMenuItem onClick={vi.fn()} className="custom-item">
        Open
      </DesktopContextMenuItem>
    );

    expect(screen.getByRole('button', { name: 'Open' })).toHaveClass(
      'custom-item'
    );
  });
});
