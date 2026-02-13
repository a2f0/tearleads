import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileText } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconSquare } from './IconSquare.js';

describe('IconSquare', () => {
  it('renders label', () => {
    render(<IconSquare icon={FileText} label="Test Label" />);
    expect(screen.getByText('Test Label')).toBeInTheDocument();
  });

  it('renders icon', () => {
    render(
      <IconSquare icon={FileText} label="Test" data-testid="icon-square" />
    );
    const square = screen.getByTestId('icon-square');
    expect(square.querySelector('svg')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<IconSquare icon={FileText} label="Click me" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows selected state', () => {
    render(
      <IconSquare
        icon={FileText}
        label="Test"
        selected
        data-testid="icon-square"
      />
    );
    expect(screen.getByTestId('icon-square')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('maintains 1:1 aspect ratio', () => {
    render(
      <IconSquare icon={FileText} label="Test" data-testid="icon-square" />
    );
    expect(screen.getByTestId('icon-square')).toHaveStyle({
      aspectRatio: '1 / 1'
    });
  });
});
