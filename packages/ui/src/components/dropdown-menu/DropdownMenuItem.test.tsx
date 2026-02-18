import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Check } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenuItem } from './DropdownMenuItem';

describe('DropdownMenuItem', () => {
  it('renders children and optional icon/check state', () => {
    render(
      <DropdownMenuItem
        onClick={vi.fn()}
        icon={<Check data-testid="icon" />}
        checked
      >
        Item
      </DropdownMenuItem>
    );

    expect(screen.getByRole('menuitem', { name: 'Item' })).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem').querySelector('svg')
    ).toBeInTheDocument();
  });

  it('handles click and keyboard activation when enabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DropdownMenuItem onClick={onClick}>Run</DropdownMenuItem>);

    const item = screen.getByRole('menuitem', { name: 'Run' });
    await user.click(item);
    item.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('blocks click and keyboard activation when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DropdownMenuItem onClick={onClick} disabled>
        Disabled
      </DropdownMenuItem>
    );

    const item = screen.getByRole('menuitem', { name: 'Disabled' });
    await user.click(item);
    item.focus();
    await user.keyboard('{Enter}');

    expect(item).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
