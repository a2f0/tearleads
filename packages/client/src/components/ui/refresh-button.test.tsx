import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RefreshButton } from './refresh-button';

describe('RefreshButton', () => {
  it('renders with aria-label', () => {
    render(<RefreshButton onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<RefreshButton onClick={handleClick} />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when loading', () => {
    render(<RefreshButton onClick={() => {}} loading />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<RefreshButton onClick={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('shows spinning animation when loading', () => {
    const { container } = render(<RefreshButton onClick={() => {}} loading />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('animate-spin');
  });

  it('does not show spinning animation when not loading', () => {
    const { container } = render(<RefreshButton onClick={() => {}} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toHaveClass('animate-spin');
  });
});
