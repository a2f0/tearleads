import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OpfsWindowMenuBar } from './OpfsWindowMenuBar';

describe('OpfsWindowMenuBar', () => {
  const defaultProps = {
    onRefresh: vi.fn(),
    onExpandAll: vi.fn(),
    onCollapseAll: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File and View menu triggers', () => {
    render(<OpfsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Refresh and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<OpfsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Refresh' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<OpfsWindowMenuBar {...defaultProps} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OpfsWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Expand All and Collapse All options in View menu', async () => {
    const user = userEvent.setup();
    render(<OpfsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Expand All' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Collapse All' })
    ).toBeInTheDocument();
  });

  it('calls onExpandAll when Expand All is clicked', async () => {
    const user = userEvent.setup();
    const onExpandAll = vi.fn();
    render(<OpfsWindowMenuBar {...defaultProps} onExpandAll={onExpandAll} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Expand All' }));

    expect(onExpandAll).toHaveBeenCalledTimes(1);
  });

  it('calls onCollapseAll when Collapse All is clicked', async () => {
    const user = userEvent.setup();
    const onCollapseAll = vi.fn();
    render(
      <OpfsWindowMenuBar {...defaultProps} onCollapseAll={onCollapseAll} />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Collapse All' }));

    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });
});
