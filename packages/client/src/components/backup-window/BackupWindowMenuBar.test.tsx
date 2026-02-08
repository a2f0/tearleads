import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BackupWindowMenuBar } from './BackupWindowMenuBar';

describe('BackupWindowMenuBar', () => {
  it('renders File menu', () => {
    render(<BackupWindowMenuBar onClose={vi.fn()} />);
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('renders View menu', () => {
    render(<BackupWindowMenuBar onClose={vi.fn()} />);
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BackupWindowMenuBar onClose={onClose} />);

    await user.click(screen.getByText('File'));
    await user.click(screen.getByText('Close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('shows Options option in View menu', async () => {
    const user = userEvent.setup();
    render(<BackupWindowMenuBar onClose={vi.fn()} />);

    await user.click(screen.getByText('View'));

    expect(screen.getByRole('menuitem', { name: 'Options' })).toBeInTheDocument();
  });
});
