import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EmailFolder } from '../../types/folder';
import { DeleteFolderDialog } from './DeleteFolderDialog';

const mockFolder: EmailFolder = {
  id: '1',
  name: 'Folder to Delete',
  folderType: 'custom',
  parentId: null,
  unreadCount: 3
};

describe('DeleteFolderDialog', () => {
  it('does not render when closed', () => {
    render(
      <DeleteFolderDialog
        open={false}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onDelete={vi.fn()}
        onFolderDeleted={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('delete-folder-dialog')
    ).not.toBeInTheDocument();
  });

  it('does not render when folder is null', () => {
    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={null}
        onDelete={vi.fn()}
        onFolderDeleted={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('delete-folder-dialog')
    ).not.toBeInTheDocument();
  });

  it('renders when open with folder', () => {
    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onDelete={vi.fn()}
        onFolderDeleted={vi.fn()}
      />
    );

    expect(screen.getByTestId('delete-folder-dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Folder')).toBeInTheDocument();
  });

  it('displays folder name in confirmation message', () => {
    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onDelete={vi.fn()}
        onFolderDeleted={vi.fn()}
      />
    );

    expect(screen.getByText(/Folder to Delete/)).toBeInTheDocument();
  });

  it('calls onDelete with folder id on confirm', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onFolderDeleted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        folder={mockFolder}
        onDelete={onDelete}
        onFolderDeleted={onFolderDeleted}
      />
    );

    await user.click(screen.getByTestId('delete-folder-confirm'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('1');
    });
    expect(onFolderDeleted).toHaveBeenCalledWith('1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows error message on failure', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onDelete={onDelete}
        onFolderDeleted={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('delete-folder-confirm'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it('closes on cancel button click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        folder={mockFolder}
        onDelete={vi.fn()}
        onFolderDeleted={vi.fn()}
      />
    );

    await user.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        folder={mockFolder}
        onDelete={vi.fn()}
        onFolderDeleted={vi.fn()}
      />
    );

    const backdrop = screen
      .getByTestId('delete-folder-dialog')
      .querySelector('[aria-hidden="true"]');
    if (backdrop) {
      await user.click(backdrop);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }
  });

  it('disables buttons while deleting', async () => {
    const user = userEvent.setup();
    let resolveDelete: (() => void) | undefined;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const onDelete = vi.fn().mockReturnValue(deletePromise);

    render(
      <DeleteFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onDelete={onDelete}
        onFolderDeleted={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('delete-folder-confirm'));

    expect(screen.getByTestId('delete-folder-confirm')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(screen.getByText('Deleting...')).toBeInTheDocument();

    resolveDelete?.();
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });
});
