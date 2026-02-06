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

  it('calls onCreateSubfolder and onClose when clicking New Subfolder', async () => {
    const user = userEvent.setup();
    const onCreateSubfolder = vi.fn();
    const onClose = vi.fn();

    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={onClose}
        onCreateSubfolder={onCreateSubfolder}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByText('New Subfolder'));
    expect(onCreateSubfolder).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onRename and onClose when clicking Rename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onClose = vi.fn();

    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={onClose}
        onCreateSubfolder={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByText('Rename'));
    expect(onRename).toHaveBeenCalledWith(mockCustomFolder);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onDelete and onClose when clicking Delete', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <EmailFolderContextMenu
        x={100}
        y={200}
        folder={mockCustomFolder}
        onClose={onClose}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith(mockCustomFolder);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking backdrop', async () => {
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

    await user.click(
      screen.getByTestId('email-folder-context-menu-backdrop')
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('renders backdrop with correct z-index', () => {
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

    const backdrop = screen.getByTestId('email-folder-context-menu-backdrop');
    expect(backdrop).toHaveStyle({ zIndex: '200' });

    const menu = screen.getByTestId('email-folder-context-menu');
    expect(menu).toHaveStyle({ zIndex: '201' });
  });
});
