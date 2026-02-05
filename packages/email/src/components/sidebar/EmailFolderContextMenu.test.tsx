import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailFolder } from '../../types/folder.js';
import { EmailFolderContextMenu } from './EmailFolderContextMenu.js';

const mockCustomFolder: EmailFolder = {
  id: 'custom-1',
  name: 'Custom Folder',
  folderType: 'custom',
  parentId: null,
  unreadCount: 0
};

const mockSystemFolder: EmailFolder = {
  id: 'inbox-1',
  name: 'Inbox',
  folderType: 'inbox',
  parentId: null,
  unreadCount: 5
};

// Suppress React act() warnings
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmailFolderContextMenu', () => {
  it('renders at specified position', () => {
    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={vi.fn()}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const menu = screen.getByTestId('email-folder-context-menu');
    expect(menu).toHaveStyle({ left: '100px', top: '200px' });
  });

  it('shows all options for custom folder', () => {
    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={vi.fn()}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('hides rename and delete for system folder', () => {
    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockSystemFolder}
        onClose={vi.fn()}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('calls onCreateSubfolder when clicking New Subfolder', async () => {
    const user = userEvent.setup();
    const onCreateSubfolder = vi.fn();

    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={vi.fn()}
        onCreateSubfolder={onCreateSubfolder}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByText('New Subfolder'));
    expect(onCreateSubfolder).toHaveBeenCalled();
  });

  it('calls onRename when clicking Rename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();

    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={vi.fn()}
        onCreateSubfolder={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByText('Rename'));
    expect(onRename).toHaveBeenCalledWith(mockCustomFolder);
  });

  it('calls onDelete when clicking Delete', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={vi.fn()}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith(mockCustomFolder);
  });

  it('calls onClose when clicking outside', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <div data-testid="outside">
        <EmailFolderContextMenu
          x={100}
          y={200}
          folder={mockCustomFolder}
          onClose={onClose}
          onCreateSubfolder={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        />
      </div>
    );

    await user.click(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when pressing Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={onClose}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('cleans up event listeners on unmount', async () => {
    const onClose = vi.fn();
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={onClose}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'mousedown',
      expect.any(Function)
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function)
    );
  });
});
