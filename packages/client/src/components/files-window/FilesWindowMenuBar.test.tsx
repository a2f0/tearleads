import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilesWindowMenuBar } from './FilesWindowMenuBar';

describe('FilesWindowMenuBar', () => {
  const defaultProps = {
    showDeleted: false,
    onShowDeletedChange: vi.fn(),
    viewMode: 'list' as const,
    onViewModeChange: vi.fn(),
    onUpload: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<FilesWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<FilesWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Upload and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<FilesWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Upload' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onUpload when Upload is clicked', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    render(<FilesWindowMenuBar {...defaultProps} onUpload={onUpload} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Upload' }));

    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FilesWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Show Deleted option in View menu', async () => {
    const user = userEvent.setup();
    render(<FilesWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Show Deleted' })
    ).toBeInTheDocument();
  });

  it('calls onShowDeletedChange with true when Show Deleted is clicked and showDeleted is false', async () => {
    const user = userEvent.setup();
    const onShowDeletedChange = vi.fn();
    render(
      <FilesWindowMenuBar
        {...defaultProps}
        showDeleted={false}
        onShowDeletedChange={onShowDeletedChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show Deleted' }));

    expect(onShowDeletedChange).toHaveBeenCalledWith(true);
  });

  it('calls onShowDeletedChange with false when Show Deleted is clicked and showDeleted is true', async () => {
    const user = userEvent.setup();
    const onShowDeletedChange = vi.fn();
    render(
      <FilesWindowMenuBar
        {...defaultProps}
        showDeleted={true}
        onShowDeletedChange={onShowDeletedChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show Deleted' }));

    expect(onShowDeletedChange).toHaveBeenCalledWith(false);
  });

  it('shows checkmark on Show Deleted when showDeleted is true', async () => {
    const user = userEvent.setup();
    render(<FilesWindowMenuBar {...defaultProps} showDeleted={true} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const showDeletedItem = screen.getByRole('menuitem', {
      name: 'Show Deleted'
    });
    const checkSpan = showDeletedItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).toBeInTheDocument();
  });

  it('does not show checkmark on Show Deleted when showDeleted is false', async () => {
    const user = userEvent.setup();
    render(<FilesWindowMenuBar {...defaultProps} showDeleted={false} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const showDeletedItem = screen.getByRole('menuitem', {
      name: 'Show Deleted'
    });
    const checkSpan = showDeletedItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows List and Table options in View menu', async () => {
    const user = userEvent.setup();
    render(<FilesWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('menuitem', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Table' })).toBeInTheDocument();
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <FilesWindowMenuBar
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
      <FilesWindowMenuBar
        {...defaultProps}
        viewMode="list"
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('shows checkmark on List when viewMode is list', async () => {
    const user = userEvent.setup();
    render(<FilesWindowMenuBar {...defaultProps} viewMode="list" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listItem = screen.getByRole('menuitem', { name: 'List' });
    const checkSpan = listItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).toBeInTheDocument();
  });

  it('shows checkmark on Table when viewMode is table', async () => {
    const user = userEvent.setup();
    render(<FilesWindowMenuBar {...defaultProps} viewMode="table" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const tableItem = screen.getByRole('menuitem', { name: 'Table' });
    const checkSpan = tableItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).toBeInTheDocument();
  });
});
