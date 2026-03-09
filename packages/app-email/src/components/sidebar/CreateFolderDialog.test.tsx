import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateFolderDialog } from './CreateFolderDialog';

describe('CreateFolderDialog', () => {
  it('does not render when closed', () => {
    render(
      <CreateFolderDialog
        open={false}
        onOpenChange={vi.fn()}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('create-folder-dialog')
    ).not.toBeInTheDocument();
  });

  it('renders when open', () => {
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    expect(screen.getByTestId('create-folder-dialog')).toBeInTheDocument();
    expect(screen.getByText('Create Folder')).toBeInTheDocument();
  });

  it('shows Create Subfolder title when parentId is provided', () => {
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId="parent-123"
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    expect(screen.getByText('Create Subfolder')).toBeInTheDocument();
  });

  it('focuses input on open', async () => {
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('create-folder-input')).toHaveFocus();
    });
  });

  it('disables submit button when input is empty', () => {
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    expect(screen.getByTestId('create-folder-submit')).toBeDisabled();
  });

  it('enables submit button when input has value', async () => {
    const user = userEvent.setup();

    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    await user.type(screen.getByTestId('create-folder-input'), 'New Folder');
    expect(screen.getByTestId('create-folder-submit')).not.toBeDisabled();
  });

  it('calls createFolder and onFolderCreated on submit', async () => {
    const user = userEvent.setup();
    const createFolder = vi.fn().mockResolvedValue({ id: '1', name: 'Test' });
    const onFolderCreated = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        parentId={null}
        onFolderCreated={onFolderCreated}
        createFolder={createFolder}
      />
    );

    await user.type(screen.getByTestId('create-folder-input'), 'Test Folder');
    await user.click(screen.getByTestId('create-folder-submit'));

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith('Test Folder', null);
    });
    expect(onFolderCreated).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes parentId to createFolder', async () => {
    const user = userEvent.setup();
    const createFolder = vi.fn().mockResolvedValue({ id: '1', name: 'Test' });

    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId="parent-123"
        onFolderCreated={vi.fn()}
        createFolder={createFolder}
      />
    );

    await user.type(screen.getByTestId('create-folder-input'), 'Subfolder');
    await user.click(screen.getByTestId('create-folder-submit'));

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith('Subfolder', 'parent-123');
    });
  });

  it('shows error message on failure', async () => {
    const user = userEvent.setup();
    const createFolder = vi
      .fn()
      .mockRejectedValue(new Error('Creation failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={createFolder}
      />
    );

    await user.type(screen.getByTestId('create-folder-input'), 'Test');
    await user.click(screen.getByTestId('create-folder-submit'));

    await waitFor(() => {
      expect(screen.getByText('Creation failed')).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it('closes on cancel button click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    await user.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={vi.fn()}
      />
    );

    const backdrop = screen
      .getByTestId('create-folder-dialog')
      .querySelector('[aria-hidden="true"]');
    if (backdrop) {
      await user.click(backdrop);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }
  });

  it('trims whitespace from folder name', async () => {
    const user = userEvent.setup();
    const createFolder = vi.fn().mockResolvedValue({ id: '1', name: 'Test' });

    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={vi.fn()}
        parentId={null}
        onFolderCreated={vi.fn()}
        createFolder={createFolder}
      />
    );

    await user.type(
      screen.getByTestId('create-folder-input'),
      '  Trimmed Name  '
    );
    await user.click(screen.getByTestId('create-folder-submit'));

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith('Trimmed Name', null);
    });
  });
});
