import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminWindowMenuBar } from './AdminWindowMenuBar';

describe('AdminWindowMenuBar', () => {
  const defaultProps = {
    onClose: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<AdminWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<AdminWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('renders shared window controls row', () => {
    render(<AdminWindowMenuBar {...defaultProps} />);
    expect(screen.getByTestId('admin-window-controls')).toBeInTheDocument();
  });

  it('renders custom controls in the shared controls row', () => {
    render(
      <AdminWindowMenuBar
        {...defaultProps}
        controls={<button type="button">Back to Admin</button>}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Back to Admin' })
    ).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    render(<AdminWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Options option in View menu', async () => {
    const user = userEvent.setup();
    render(<AdminWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });
});
