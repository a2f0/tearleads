import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPreserveWindowState } from '@/lib/windowStatePreference';
import { CacheStorageWindowMenuBar } from './CacheStorageWindowMenuBar';

describe('CacheStorageWindowMenuBar', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
  });

  it('renders File and View menu triggers', () => {
    render(<CacheStorageWindowMenuBar onRefresh={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Preserve Window State in the View menu', async () => {
    const user = userEvent.setup();
    render(<CacheStorageWindowMenuBar onRefresh={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Preserve Window State' })
    ).toBeInTheDocument();
  });
});
