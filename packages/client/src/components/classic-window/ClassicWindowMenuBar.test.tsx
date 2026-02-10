import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClassicWindowMenuBar } from './ClassicWindowMenuBar';

vi.mock('@/components/window-menu/AboutMenuItem', () => ({
  AboutMenuItem: () => <div>About</div>
}));

vi.mock('@/components/window-menu/WindowOptionsMenuItem', () => ({
  WindowOptionsMenuItem: () => <div>Window Options</div>
}));

describe('ClassicWindowMenuBar', () => {
  it('renders top-level menu buttons', () => {
    render(<ClassicWindowMenuBar onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entries' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('invokes onClose from File menu', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ClassicWindowMenuBar onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows selecting New Entry without error', async () => {
    const user = userEvent.setup();
    render(<ClassicWindowMenuBar onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New Entry' }));

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });
});
