import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AudioWindowMenuBar } from './AudioWindowMenuBar';

describe('AudioWindowMenuBar', () => {
  const defaultProps = {
    onClose: vi.fn(),
    view: 'list' as const,
    onViewChange: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<AudioWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    render(<AudioWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AudioWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders View menu trigger', () => {
    render(<AudioWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows List View and Table View options in View menu', async () => {
    const user = userEvent.setup();
    render(<AudioWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'List View' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Table View' })
    ).toBeInTheDocument();
  });

  it('calls onViewChange with list when List View is clicked', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(
      <AudioWindowMenuBar
        {...defaultProps}
        view="table"
        onViewChange={onViewChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'List View' }));

    expect(onViewChange).toHaveBeenCalledWith('list');
  });

  it('calls onViewChange with table when Table View is clicked', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(
      <AudioWindowMenuBar
        {...defaultProps}
        view="list"
        onViewChange={onViewChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table View' }));

    expect(onViewChange).toHaveBeenCalledWith('table');
  });

  it('shows check mark on List View when view is list', async () => {
    const user = userEvent.setup();
    render(<AudioWindowMenuBar {...defaultProps} view="list" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listViewItem = screen.getByRole('menuitem', { name: 'List View' });
    const tableViewItem = screen.getByRole('menuitem', { name: 'Table View' });

    expect(listViewItem.querySelector('svg')).toBeInTheDocument();
    expect(tableViewItem.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows check mark on Table View when view is table', async () => {
    const user = userEvent.setup();
    render(<AudioWindowMenuBar {...defaultProps} view="table" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listViewItem = screen.getByRole('menuitem', { name: 'List View' });
    const tableViewItem = screen.getByRole('menuitem', { name: 'Table View' });

    expect(listViewItem.querySelector('svg')).not.toBeInTheDocument();
    expect(tableViewItem.querySelector('svg')).toBeInTheDocument();
  });
});
