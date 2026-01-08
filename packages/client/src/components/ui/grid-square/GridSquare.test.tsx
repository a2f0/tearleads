import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GridSquare } from './GridSquare';

describe('GridSquare', () => {
  it('renders children', () => {
    render(<GridSquare>Content</GridSquare>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<GridSquare onClick={onClick}>Click me</GridSquare>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows selected state', () => {
    render(
      <GridSquare selected data-testid="square">
        Content
      </GridSquare>
    );
    expect(screen.getByTestId('square').className).toContain('ring-2');
  });

  it('maintains 1:1 aspect ratio', () => {
    render(<GridSquare data-testid="square">Content</GridSquare>);
    expect(screen.getByTestId('square')).toHaveStyle({ aspectRatio: '1 / 1' });
  });

  it('applies custom className', () => {
    render(
      <GridSquare className="custom-class" data-testid="square">
        Content
      </GridSquare>
    );
    expect(screen.getByTestId('square').className).toContain('custom-class');
  });
});
