import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilesWindowMenuBar } from './FilesWindowMenuBar';

describe('FilesWindowMenuBar', () => {
  const defaultProps = {
    showDeleted: false,
    onShowDeletedChange: vi.fn(),
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
});
