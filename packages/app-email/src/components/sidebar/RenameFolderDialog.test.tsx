import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EmailFolder } from '../../types/folder';
import { RenameFolderDialog } from './RenameFolderDialog';

const mockFolder: EmailFolder = {
  id: '1',
  name: 'Original Name',
  folderType: 'custom',
  parentId: null,
  unreadCount: 0
};

describe('RenameFolderDialog', () => {
  it('does not render when closed', () => {
    render(
      <RenameFolderDialog
        open={false}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onRename={vi.fn()}
        onFolderRenamed={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('rename-folder-dialog')
    ).not.toBeInTheDocument();
  });

  it('does not render when folder is null', () => {
    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={null}
        onRename={vi.fn()}
        onFolderRenamed={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('rename-folder-dialog')
    ).not.toBeInTheDocument();
  });

  it('renders when open with folder', () => {
    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onRename={vi.fn()}
        onFolderRenamed={vi.fn()}
      />
    );

    expect(screen.getByTestId('rename-folder-dialog')).toBeInTheDocument();
    expect(screen.getByText('Rename Folder')).toBeInTheDocument();
  });

  it('prefills input with folder name', () => {
    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onRename={vi.fn()}
        onFolderRenamed={vi.fn()}
      />
    );

    expect(screen.getByTestId('rename-folder-input')).toHaveValue(
      'Original Name'
    );
  });

  it('disables submit when name unchanged', () => {
    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onRename={vi.fn()}
        onFolderRenamed={vi.fn()}
      />
    );

    expect(screen.getByTestId('rename-folder-submit')).toBeDisabled();
  });

  it('enables submit when name is changed', async () => {
    const user = userEvent.setup();

    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onRename={vi.fn()}
        onFolderRenamed={vi.fn()}
      />
    );

    await user.clear(screen.getByTestId('rename-folder-input'));
    await user.type(screen.getByTestId('rename-folder-input'), 'New Name');

    expect(screen.getByTestId('rename-folder-submit')).not.toBeDisabled();
  });

  it('calls onRename with folder id and new name', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onFolderRenamed = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        folder={mockFolder}
        onRename={onRename}
        onFolderRenamed={onFolderRenamed}
      />
    );

    const input = screen.getByTestId('rename-folder-input');
    fireEvent.change(input, { target: { value: 'Updated Name' } });
    await user.click(screen.getByTestId('rename-folder-submit'));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('1', 'Updated Name');
    });
    expect(onFolderRenamed).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without rename when name is unchanged via cancel', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        folder={mockFolder}
        onRename={onRename}
        onFolderRenamed={vi.fn()}
      />
    );

    // The submit button is disabled when name is unchanged
    expect(screen.getByTestId('rename-folder-submit')).toBeDisabled();

    // Click cancel instead
    await user.click(screen.getByText('Cancel'));

    // Should close without calling onRename
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('shows error message on failure', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockRejectedValue(new Error('Rename failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onRename={onRename}
        onFolderRenamed={vi.fn()}
      />
    );

    await user.clear(screen.getByTestId('rename-folder-input'));
    await user.type(screen.getByTestId('rename-folder-input'), 'New Name');
    await user.click(screen.getByTestId('rename-folder-submit'));

    await waitFor(() => {
      expect(screen.getByText('Rename failed')).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it('closes on cancel button click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        folder={mockFolder}
        onRename={vi.fn()}
        onFolderRenamed={vi.fn()}
      />
    );

    await user.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('trims whitespace from new name', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(
      <RenameFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        folder={mockFolder}
        onRename={onRename}
        onFolderRenamed={vi.fn()}
      />
    );

    await user.clear(screen.getByTestId('rename-folder-input'));
    await user.type(screen.getByTestId('rename-folder-input'), '  Trimmed  ');
    await user.click(screen.getByTestId('rename-folder-submit'));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('1', 'Trimmed');
    });
  });
});
