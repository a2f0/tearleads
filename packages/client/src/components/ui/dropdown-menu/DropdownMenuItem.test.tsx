import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Check } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenuItem } from './DropdownMenuItem';

describe('DropdownMenuItem', () => {
  it('renders children', () => {
    render(<DropdownMenuItem onClick={vi.fn()}>New</DropdownMenuItem>);
    expect(screen.getByRole('menuitem', { name: 'New' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DropdownMenuItem onClick={onClick}>New</DropdownMenuItem>);

    await user.click(screen.getByRole('menuitem', { name: 'New' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows checkmark when checked', () => {
    render(
      <DropdownMenuItem onClick={vi.fn()} checked>
        List View
      </DropdownMenuItem>
    );

    const checkIcon = screen.getByRole('menuitem').querySelector('svg');
    expect(checkIcon).toBeInTheDocument();
  });

  it('does not show checkmark when unchecked', () => {
    render(
      <DropdownMenuItem onClick={vi.fn()} checked={false}>
        List View
      </DropdownMenuItem>
    );

    const checkIcon = screen.getByRole('menuitem').querySelector('svg');
    expect(checkIcon).not.toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(
      <DropdownMenuItem onClick={vi.fn()} icon={<Check data-testid="icon" />}>
        Item
      </DropdownMenuItem>
    );

    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DropdownMenuItem onClick={onClick} disabled>
        Disabled
      </DropdownMenuItem>
    );

    const item = screen.getByRole('menuitem', { name: 'Disabled' });
    expect(item).toBeDisabled();

    await user.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('handles keyboard activation with Enter', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DropdownMenuItem onClick={onClick}>Item</DropdownMenuItem>);

    const item = screen.getByRole('menuitem');
    item.focus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('handles keyboard activation with Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DropdownMenuItem onClick={onClick}>Item</DropdownMenuItem>);

    const item = screen.getByRole('menuitem');
    item.focus();
    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
