import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenuItem } from './ContextMenuItem';

describe('ContextMenuItem', () => {
  it('renders children', () => {
    render(<ContextMenuItem onClick={() => {}}>Get info</ContextMenuItem>);

    expect(screen.getByText('Get info')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(
      <ContextMenuItem
        icon={<span data-testid="test-icon">Icon</span>}
        onClick={() => {}}
      >
        Get info
      </ContextMenuItem>
    );

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<ContextMenuItem onClick={onClick}>Get info</ContextMenuItem>);

    await user.click(screen.getByText('Get info'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders as a button element', () => {
    render(<ContextMenuItem onClick={() => {}}>Get info</ContextMenuItem>);

    expect(
      screen.getByRole('button', { name: /get info/i })
    ).toBeInTheDocument();
  });
});
