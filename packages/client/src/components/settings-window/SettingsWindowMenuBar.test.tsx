import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsWindowMenuBar } from './SettingsWindowMenuBar';

describe('SettingsWindowMenuBar', () => {
  const defaultProps = {
    compact: false,
    onCompactChange: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<SettingsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<SettingsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    render(<SettingsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Compact option in View menu', async () => {
    const user = userEvent.setup();
    render(<SettingsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Compact' })
    ).toBeInTheDocument();
  });

  it('calls onCompactChange with true when Compact is clicked while not compact', async () => {
    const user = userEvent.setup();
    const onCompactChange = vi.fn();
    render(
      <SettingsWindowMenuBar
        {...defaultProps}
        compact={false}
        onCompactChange={onCompactChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Compact' }));

    expect(onCompactChange).toHaveBeenCalledWith(true);
  });

  it('calls onCompactChange with false when Compact is clicked while compact', async () => {
    const user = userEvent.setup();
    const onCompactChange = vi.fn();
    render(
      <SettingsWindowMenuBar
        {...defaultProps}
        compact={true}
        onCompactChange={onCompactChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Compact' }));

    expect(onCompactChange).toHaveBeenCalledWith(false);
  });

  it('shows checkmark on Compact when compact is true', async () => {
    const user = userEvent.setup();
    render(<SettingsWindowMenuBar {...defaultProps} compact={true} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const compactItem = screen.getByRole('menuitem', { name: 'Compact' });
    const checkSpan = compactItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).toBeInTheDocument();
  });

  it('does not show checkmark on Compact when compact is false', async () => {
    const user = userEvent.setup();
    render(<SettingsWindowMenuBar {...defaultProps} compact={false} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const compactItem = screen.getByRole('menuitem', { name: 'Compact' });
    const checkSpan = compactItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).not.toBeInTheDocument();
  });
});
