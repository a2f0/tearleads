import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DebugOptionsGrid } from './DebugOptionsGrid';

vi.mock('@tearleads/ui', () => ({
  IconSquare: ({
    label,
    onClick,
    'data-testid': testId
  }: {
    label: string;
    onClick: () => void;
    'data-testid'?: string;
  }) => (
    <button type="button" onClick={onClick} data-testid={testId}>
      {label}
    </button>
  )
}));

describe('DebugOptionsGrid', () => {
  it('renders all debug options', () => {
    render(<DebugOptionsGrid onSelect={vi.fn()} />);

    expect(screen.getByTestId('debug-option-system-info')).toBeInTheDocument();
    expect(screen.getByTestId('debug-option-browser')).toBeInTheDocument();
  });

  it('displays correct labels', () => {
    render(<DebugOptionsGrid onSelect={vi.fn()} />);

    expect(screen.getByText('System Info')).toBeInTheDocument();
    expect(screen.getByText('Browser')).toBeInTheDocument();
  });

  it('calls onSelect with system-info when System Info is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DebugOptionsGrid onSelect={onSelect} />);

    await user.click(screen.getByTestId('debug-option-system-info'));

    expect(onSelect).toHaveBeenCalledWith('system-info');
  });

  it('calls onSelect with browser when Browser is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DebugOptionsGrid onSelect={onSelect} />);

    await user.click(screen.getByTestId('debug-option-browser'));

    expect(onSelect).toHaveBeenCalledWith('browser');
  });
});
