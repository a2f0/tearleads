import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VfsWindowMenuBar } from './VfsWindowMenuBar';

describe('VfsWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'list' as const,
    onViewModeChange: vi.fn(),
    onNewFolder: vi.fn(),
    onLinkItem: vi.fn(),
    onRefresh: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File and View menu triggers', () => {
    render(<VfsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows New Folder, Link Item, and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<VfsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'New Folder' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Link Item...' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onNewFolder when New Folder is clicked', async () => {
    const user = userEvent.setup();
    const onNewFolder = vi.fn();
    render(<VfsWindowMenuBar {...defaultProps} onNewFolder={onNewFolder} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New Folder' }));

    expect(onNewFolder).toHaveBeenCalledTimes(1);
  });

  it('calls onLinkItem when Link Item is clicked', async () => {
    const user = userEvent.setup();
    const onLinkItem = vi.fn();
    render(<VfsWindowMenuBar {...defaultProps} onLinkItem={onLinkItem} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Link Item...' }));

    expect(onLinkItem).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VfsWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows List, Table, and Refresh options in View menu', async () => {
    const user = userEvent.setup();
    render(<VfsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('menuitem', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Table' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Refresh' })
    ).toBeInTheDocument();
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <VfsWindowMenuBar
        {...defaultProps}
        viewMode="table"
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'List' }));

    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('calls onViewModeChange with table when Table is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <VfsWindowMenuBar {...defaultProps} onViewModeChange={onViewModeChange} />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<VfsWindowMenuBar {...defaultProps} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows checkmark on List when viewMode is list', async () => {
    const user = userEvent.setup();
    render(<VfsWindowMenuBar {...defaultProps} viewMode="list" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listItem = screen.getByRole('menuitem', { name: 'List' });
    expect(listItem.querySelector('svg.lucide-check')).toBeInTheDocument();
  });

  it('shows checkmark on Table when viewMode is table', async () => {
    const user = userEvent.setup();
    render(<VfsWindowMenuBar {...defaultProps} viewMode="table" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const tableItem = screen.getByRole('menuitem', { name: 'Table' });
    expect(tableItem.querySelector('svg.lucide-check')).toBeInTheDocument();
  });
});
