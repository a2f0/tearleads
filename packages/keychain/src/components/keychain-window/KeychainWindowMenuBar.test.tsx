import { clearPreserveWindowState } from '@tearleads/window-manager';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeychainWindowMenuBar } from './KeychainWindowMenuBar';

vi.mock('@tearleads/keychain/package.json', () => ({
  default: { version: '7.8.9' }
}));

describe('KeychainWindowMenuBar', () => {
  const defaultProps = {
    onRefresh: vi.fn(),
    onClose: vi.fn()
  };

  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
  });

  it('renders File menu trigger', () => {
    render(<KeychainWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows Refresh and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<KeychainWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Refresh' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders View and Help menu triggers', () => {
    render(<KeychainWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('shows Options in View menu', async () => {
    const user = userEvent.setup();
    render(<KeychainWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<KeychainWindowMenuBar {...defaultProps} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<KeychainWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens About dialog from Help menu using keychain package version', async () => {
    const user = userEvent.setup();
    render(<KeychainWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('About Keychain')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('7.8.9');
  });
});
