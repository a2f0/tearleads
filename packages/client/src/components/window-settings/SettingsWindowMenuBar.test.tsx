import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsWindowMenuBar } from './SettingsWindowMenuBar';

describe('SettingsWindowMenuBar', () => {
  const defaultProps = {
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

  it('shows Options option in View menu', async () => {
    const user = userEvent.setup();
    render(<SettingsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });

  it('closes the View menu when options dialog is dismissed', async () => {
    const user = userEvent.setup();
    render(<SettingsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Options' }));

    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('window-options-cancel'));

    expect(
      screen.queryByRole('menuitem', { name: 'Options' })
    ).not.toBeInTheDocument();
  });
});
