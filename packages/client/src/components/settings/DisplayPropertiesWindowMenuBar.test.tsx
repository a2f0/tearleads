import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DisplayPropertiesWindowMenuBar } from './DisplayPropertiesWindowMenuBar';

describe('DisplayPropertiesWindowMenuBar', () => {
  it('renders File menu trigger', () => {
    render(<DisplayPropertiesWindowMenuBar onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    render(<DisplayPropertiesWindowMenuBar onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DisplayPropertiesWindowMenuBar onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
