import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LocalStorageWindowMenuBar } from './LocalStorageWindowMenuBar';

describe('LocalStorageWindowMenuBar', () => {
  it('renders the File menu trigger', () => {
    render(<LocalStorageWindowMenuBar onRefresh={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows Refresh and Close options in the File menu', async () => {
    const user = userEvent.setup();
    render(<LocalStorageWindowMenuBar onRefresh={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Refresh' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <LocalStorageWindowMenuBar onRefresh={onRefresh} onClose={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LocalStorageWindowMenuBar onRefresh={vi.fn()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
