import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';
import { FolderContextMenu } from './FolderContextMenu';

const cutMock = vi.fn();
const copyMock = vi.fn();

vi.mock('../context', () => ({
  useVfsExplorerContext: () => ({
    ui: {
      ContextMenu: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
      ),
      ContextMenuItem: ({
        children,
        onClick
      }: {
        children: ReactNode;
        onClick: () => void;
      }) => (
        <button type="button" onClick={onClick}>
          {children}
        </button>
      ),
      ContextMenuSeparator: () => <hr />
    },
    vfsShareApi: {}
  }),
  useVfsClipboard: () => ({
    cut: cutMock,
    copy: copyMock,
    hasItems: true
  })
}));

describe('FolderContextMenu', () => {
  const defaultProps = {
    x: 0,
    y: 0,
    folder: {
      id: 'folder-1',
      objectType: 'folder' as const,
      name: 'Folder 1',
      parentId: null,
      childCount: 0,
      children: []
    },
    onClose: vi.fn(),
    onNewSubfolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onShare: vi.fn(),
    onPaste: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows full actions for regular folders', async () => {
    const user = userEvent.setup();
    render(<FolderContextMenu {...defaultProps} />);

    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(screen.getByText('Cut')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();

    await user.click(screen.getByText('Cut'));
    expect(cutMock).toHaveBeenCalledWith([
      { id: 'folder-1', objectType: 'folder', name: 'Folder 1' }
    ]);
  });

  it('hides destructive and rename actions for VFS root', () => {
    render(
      <FolderContextMenu
        {...defaultProps}
        folder={{
          id: VFS_ROOT_ID,
          objectType: 'folder' as const,
          name: 'VFS Root',
          parentId: null,
          childCount: 0,
          children: []
        }}
      />
    );

    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Sharing')).not.toBeInTheDocument();
    expect(screen.queryByText('Cut')).not.toBeInTheDocument();
    expect(screen.queryByText('Copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows non-folder actions for playlist containers', () => {
    render(
      <FolderContextMenu
        {...defaultProps}
        folder={{
          id: 'playlist-1',
          objectType: 'playlist' as const,
          name: 'Road Trip',
          parentId: 'folder-1',
          childCount: 0,
          children: []
        }}
      />
    );

    expect(screen.queryByText('New Subfolder')).not.toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Sharing')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.getByText('Cut')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
  });
});
