import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';

// Mock hooks
vi.mock('../hooks', () => ({
  useVfsFolders: vi.fn(),
  useEnsureVfsRoot: vi.fn(() => ({
    isReady: true,
    isCreating: false,
    error: null,
    ensureRoot: vi.fn()
  }))
}));

// Mock context
vi.mock('../context', () => ({
  useVfsExplorerContext: vi.fn(() => ({
    ui: {
      ContextMenu: ({ children }: { children: ReactNode }) => (
        <div data-testid="mock-context-menu">{children}</div>
      ),
      ContextMenuItem: ({
        children,
        onClick
      }: {
        children: ReactNode;
        onClick?: () => void;
      }) => (
        <button type="button" onClick={onClick}>
          {children}
        </button>
      ),
      ContextMenuSeparator: () => <hr />
    }
  })),
  useVfsClipboard: vi.fn(() => ({
    clipboard: { items: [], operation: null },
    cut: vi.fn(),
    copy: vi.fn(),
    clear: vi.fn(),
    hasItems: false,
    isCut: false,
    isCopy: false
  }))
}));

// Mock dialog components that require VfsExplorerContext
vi.mock('./NewFolderDialog', () => ({
  NewFolderDialog: () => null
}));

vi.mock('./RenameFolderDialog', () => ({
  RenameFolderDialog: () => null
}));

vi.mock('./DeleteFolderDialog', () => ({
  DeleteFolderDialog: () => null
}));

vi.mock('./FolderContextMenu', () => ({
  FolderContextMenu: () => null
}));

import { useVfsFolders } from '../hooks';
import { VfsTreePanel } from './VfsTreePanel';

const mockFolders = [
  {
    id: VFS_ROOT_ID,
    objectType: 'folder' as const,
    name: 'VFS Root',
    parentId: null,
    childCount: 2,
    children: [
      {
        id: 'root-1',
        objectType: 'folder' as const,
        name: 'My Documents',
        parentId: VFS_ROOT_ID,
        childCount: 2,
        children: [
          {
            id: 'folder-1',
            objectType: 'folder' as const,
            name: 'Work',
            parentId: 'root-1',
            childCount: 0
          },
          {
            id: 'folder-2',
            objectType: 'folder' as const,
            name: 'Personal',
            parentId: 'root-1',
            childCount: 1,
            children: [
              {
                id: 'folder-3',
                objectType: 'folder' as const,
                name: 'Photos',
                parentId: 'folder-2',
                childCount: 0
              }
            ]
          }
        ]
      },
      {
        id: 'root-2',
        objectType: 'folder' as const,
        name: 'Team Files',
        parentId: VFS_ROOT_ID,
        childCount: 1,
        children: [
          {
            id: 'playlist-1',
            objectType: 'playlist' as const,
            name: 'Road Trip',
            parentId: 'root-2',
            childCount: 0
          }
        ]
      },
      {
        id: 'email-inbox',
        objectType: 'emailFolder' as const,
        name: 'Inbox',
        parentId: VFS_ROOT_ID,
        childCount: 1,
        children: [
          {
            id: 'email-projects',
            objectType: 'emailFolder' as const,
            name: 'Projects',
            parentId: 'email-inbox',
            childCount: 0
          }
        ]
      }
    ]
  }
];

describe('VfsTreePanel', () => {
  const defaultProps = {
    width: 240,
    onWidthChange: vi.fn(),
    selectedFolderId: null,
    onFolderSelect: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useVfsFolders).mockReturnValue({
      folders: mockFolders,
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
  });

  it('renders header with Folders title', () => {
    render(<VfsTreePanel {...defaultProps} />);
    expect(screen.getByText('Folders')).toBeInTheDocument();
  });

  it('renders folders from hook', () => {
    render(<VfsTreePanel {...defaultProps} />);
    expect(screen.getByText('VFS Root')).toBeInTheDocument();
    expect(screen.getByText('My Documents')).toBeInTheDocument();
    expect(screen.getByText('Team Files')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.queryByText('Road Trip')).not.toBeInTheDocument();
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });

  it('shows loading state', () => {
    vi.mocked(useVfsFolders).mockReturnValue({
      folders: [],
      loading: true,
      error: null,
      hasFetched: false,
      refetch: vi.fn()
    });
    render(<VfsTreePanel {...defaultProps} />);
    expect(screen.queryByText('My Documents')).not.toBeInTheDocument();
  });

  it('shows error state', () => {
    vi.mocked(useVfsFolders).mockReturnValue({
      folders: [],
      loading: false,
      error: 'Failed to load folders',
      hasFetched: true,
      refetch: vi.fn()
    });
    render(<VfsTreePanel {...defaultProps} />);
    expect(screen.getByText('Failed to load folders')).toBeInTheDocument();
  });

  it('shows unfiled items entry even when no folders', () => {
    vi.mocked(useVfsFolders).mockReturnValue({
      folders: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
    render(<VfsTreePanel {...defaultProps} />);
    expect(screen.getByText('Unfiled Items')).toBeInTheDocument();
  });

  it('renders all virtual folder entries', () => {
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.getByText('Unfiled Items')).toBeInTheDocument();
    expect(screen.getByText('All Items')).toBeInTheDocument();
    expect(screen.getByText('My Shared Items')).toBeInTheDocument();
    expect(screen.getByText('Shared With Me')).toBeInTheDocument();
    expect(screen.getByText('Trash')).toBeInTheDocument();
  });

  it('calls onFolderSelect when folder is clicked', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    render(<VfsTreePanel {...defaultProps} onFolderSelect={onFolderSelect} />);

    await user.click(screen.getByText('My Documents'));
    expect(onFolderSelect).toHaveBeenCalledWith('root-1');
  });

  it('selects playlist containers from the tree', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    render(<VfsTreePanel {...defaultProps} onFolderSelect={onFolderSelect} />);

    await user.dblClick(screen.getByText('Team Files'));
    await user.click(screen.getByText('Road Trip'));

    expect(onFolderSelect).toHaveBeenCalledWith('playlist-1');
  });

  it('renders nested email folders as a tree and supports selection', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    render(<VfsTreePanel {...defaultProps} onFolderSelect={onFolderSelect} />);

    await user.dblClick(screen.getByText('Inbox'));
    await user.click(screen.getByText('Projects'));

    expect(onFolderSelect).toHaveBeenCalledWith('email-projects');
  });

  it('expands folder to show children when chevron is double-clicked', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.queryByText('Work')).not.toBeInTheDocument();

    const myDocuments = screen.getByText('My Documents');
    await user.dblClick(myDocuments);

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('collapses folder when double-clicked again', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    const myDocuments = screen.getByText('My Documents');
    await user.dblClick(myDocuments);
    expect(screen.getByText('Work')).toBeInTheDocument();

    await user.dblClick(myDocuments);
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });

  it('applies selected style to selected folder', () => {
    const { rerender } = render(
      <VfsTreePanel {...defaultProps} selectedFolderId={null} />
    );

    const myDocsButton = screen.getByText('My Documents').closest('button');
    expect(myDocsButton).not.toHaveClass('bg-accent');

    rerender(<VfsTreePanel {...defaultProps} selectedFolderId="root-1" />);
    expect(myDocsButton).toHaveClass('bg-accent');
  });

  it('applies custom width', () => {
    const { container } = render(
      <VfsTreePanel {...defaultProps} width={300} />
    );
    const panel = container.firstChild;
    expect(panel).toHaveStyle({ width: '300px' });
  });

  it('has resize handle', () => {
    const { container } = render(<VfsTreePanel {...defaultProps} />);
    const resizeHandle = container.querySelector(
      '[class*="cursor-col-resize"]'
    );
    expect(resizeHandle).toBeInTheDocument();
  });

  it('handles resize drag on document', () => {
    const onWidthChange = vi.fn();
    const { container } = render(
      <VfsTreePanel {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = container.querySelector(
      '[class*="cursor-col-resize"]'
    );
    if (!resizeHandle) {
      throw new Error('Resize handle not found');
    }

    fireEvent.mouseDown(resizeHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalled();
  });

  it('constrains resize within bounds', () => {
    const onWidthChange = vi.fn();
    const { container } = render(
      <VfsTreePanel {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = container.querySelector(
      '[class*="cursor-col-resize"]'
    );
    if (!resizeHandle) {
      throw new Error('Resize handle not found');
    }

    fireEvent.mouseDown(resizeHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 50 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalled();
    const lastCall =
      onWidthChange.mock.calls[onWidthChange.mock.calls.length - 1];
    expect(lastCall?.[0]).toBeGreaterThanOrEqual(150);
  });

  it('expands folder via chevron keyboard enter', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.queryByText('Work')).not.toBeInTheDocument();

    const myDocumentsButton = screen
      .getByText('My Documents')
      .closest('button');
    const myDocsChevron = myDocumentsButton?.querySelector('[role="button"]');

    if (myDocsChevron instanceof HTMLElement) {
      myDocsChevron.focus();
      await user.keyboard('{Enter}');
    }

    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('expands folder via chevron keyboard space', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.queryByText('Work')).not.toBeInTheDocument();

    const myDocumentsButton = screen
      .getByText('My Documents')
      .closest('button');
    const myDocsChevron = myDocumentsButton?.querySelector('[role="button"]');

    if (myDocsChevron instanceof HTMLElement) {
      myDocsChevron.focus();
      await user.keyboard(' ');
    }

    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('calls onFolderSelect when Unfiled Items is clicked', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    render(<VfsTreePanel {...defaultProps} onFolderSelect={onFolderSelect} />);

    await user.click(screen.getByText('Unfiled Items'));
    expect(onFolderSelect).toHaveBeenCalledWith('__unfiled__');
  });

  it('expands folder via chevron click', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.queryByText('Work')).not.toBeInTheDocument();

    // Find the chevron span by role button
    const myDocumentsButton = screen
      .getByText('My Documents')
      .closest('button');
    const myDocsChevron = myDocumentsButton?.querySelector('[role="button"]');

    if (myDocsChevron instanceof HTMLElement) {
      await user.click(myDocsChevron);
    }

    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('calls refetch when refreshToken changes', () => {
    const mockRefetch = vi.fn();
    vi.mocked(useVfsFolders).mockReturnValue({
      folders: mockFolders,
      loading: false,
      error: null,
      hasFetched: true,
      refetch: mockRefetch
    });

    const { rerender } = render(
      <VfsTreePanel {...defaultProps} refreshToken={0} />
    );

    expect(mockRefetch).not.toHaveBeenCalled();

    rerender(<VfsTreePanel {...defaultProps} refreshToken={1} />);

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
