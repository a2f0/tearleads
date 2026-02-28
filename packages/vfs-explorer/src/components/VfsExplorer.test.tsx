import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable clipboard state for per-test control
const mockClipboardState: {
  items: { id: string; objectType: string; name: string }[];
  operation: 'cut' | 'copy' | null;
} = {
  items: [],
  operation: null
};

const mockClearClipboard = vi.fn();

// Mock the context
vi.mock('../context', () => ({
  useDatabaseState: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  }),
  useVfsExplorerContext: () => ({
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
  }),
  useVfsClipboard: () => ({
    clipboard: mockClipboardState,
    cut: vi.fn(),
    copy: vi.fn(),
    clear: mockClearClipboard,
    hasItems: mockClipboardState.items.length > 0,
    isCut: mockClipboardState.operation === 'cut',
    isCopy: mockClipboardState.operation === 'copy'
  }),
  VfsClipboardProvider: ({ children }: { children: ReactNode }) => children
}));

// Create stable mock return values to prevent infinite loops
const mockUnfiledItems = {
  items: [],
  loading: false,
  error: null,
  hasFetched: true,
  refetch: vi.fn()
};

const mockAllItems = {
  items: [],
  loading: false,
  error: null,
  hasFetched: true,
  refetch: vi.fn()
};

const mockMoveVfsItem = {
  moveItem: vi.fn(),
  isMoving: false,
  error: null
};

const mockCopyVfsItem = {
  copyItem: vi.fn(),
  isCopying: false,
  error: null
};

const mockEnsureVfsRoot = {
  isReady: true,
  isCreating: false,
  error: null,
  ensureRoot: vi.fn()
};

const mockSharedByMe = {
  items: [],
  loading: false,
  error: null,
  hasFetched: true,
  refetch: vi.fn()
};

const mockSharedWithMe = {
  items: [],
  loading: false,
  error: null,
  hasFetched: true,
  refetch: vi.fn()
};

const mockTrashItems = {
  items: [],
  loading: false,
  error: null,
  hasFetched: true,
  refetch: vi.fn()
};

// Mock the hooks
vi.mock('../hooks', () => ({
  useVfsFolders: vi.fn(),
  useVfsFolderContents: vi.fn(),
  useVfsUnfiledItems: vi.fn(() => mockUnfiledItems),
  useVfsAllItems: vi.fn(() => mockAllItems),
  useVfsSharedByMe: vi.fn(() => mockSharedByMe),
  useVfsSharedWithMe: vi.fn(() => mockSharedWithMe),
  useVfsTrashItems: vi.fn(() => mockTrashItems),
  useMoveVfsItem: vi.fn(() => mockMoveVfsItem),
  useCopyVfsItem: vi.fn(() => mockCopyVfsItem),
  useEnsureVfsRoot: vi.fn(() => mockEnsureVfsRoot)
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

import { useVfsFolderContents, useVfsFolders } from '../hooks';
import { VfsExplorer } from './VfsExplorer';

describe('VfsExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset clipboard state
    mockClipboardState.items = [];
    mockClipboardState.operation = null;
    vi.mocked(useVfsFolders).mockReturnValue({
      folders: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
  });

  it('renders tree panel and details panel', () => {
    render(<VfsExplorer />);
    expect(screen.getByText('Folders')).toBeInTheDocument();
    // Default view shows unfiled items
    expect(screen.getByText('No unfiled items')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<VfsExplorer className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders with list view mode by default', () => {
    render(<VfsExplorer />);
    // Default view shows unfiled items
    expect(screen.getByText('No unfiled items')).toBeInTheDocument();
  });

  it('renders with table view mode when specified', () => {
    render(<VfsExplorer viewMode="table" />);
    // Default view shows unfiled items
    expect(screen.getByText('No unfiled items')).toBeInTheDocument();
  });

  describe('paste operations', () => {
    it('calls copyItem when pasting into an empty folder via context menu', async () => {
      // Set up clipboard with a copied file
      mockClipboardState.items = [
        { id: 'file-1', objectType: 'file', name: 'document.pdf' }
      ];
      mockClipboardState.operation = 'copy';

      // Mock folders so we have a folder to select
      vi.mocked(useVfsFolders).mockReturnValue({
        folders: [
          {
            id: 'folder-1',
            objectType: 'folder',
            name: 'My Folder',
            parentId: null,
            childCount: 0,
            children: []
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      // Folder contents are empty (newly created folder)
      vi.mocked(useVfsFolderContents).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      render(<VfsExplorer selectedFolderId="folder-1" />);

      // Verify we see the empty folder state
      expect(screen.getByText('This folder is empty')).toBeInTheDocument();

      // Right-click on the empty space to trigger context menu
      const emptyState = screen.getByText('This folder is empty');
      fireEvent.contextMenu(emptyState);

      // The Paste button should appear (hasItems is true)
      const pasteButton = screen.getByText('Paste');
      expect(pasteButton).toBeInTheDocument();

      // Click the Paste button
      fireEvent.click(pasteButton);

      // Verify copyItem was called with correct arguments
      await waitFor(() => {
        expect(mockCopyVfsItem.copyItem).toHaveBeenCalledWith(
          'file-1',
          'folder-1'
        );
      });
    });

    it('calls moveItem when pasting a cut item', async () => {
      // Set up clipboard with a cut file
      mockClipboardState.items = [
        { id: 'file-2', objectType: 'note', name: 'My Note' }
      ];
      mockClipboardState.operation = 'cut';

      vi.mocked(useVfsFolders).mockReturnValue({
        folders: [
          {
            id: 'folder-2',
            objectType: 'folder',
            name: 'Target Folder',
            parentId: null,
            childCount: 0,
            children: []
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      vi.mocked(useVfsFolderContents).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      render(<VfsExplorer selectedFolderId="folder-2" />);

      const emptyState = screen.getByText('This folder is empty');
      fireEvent.contextMenu(emptyState);

      const pasteButton = screen.getByText('Paste');
      fireEvent.click(pasteButton);

      await waitFor(() => {
        expect(mockMoveVfsItem.moveItem).toHaveBeenCalledWith(
          'file-2',
          'folder-2'
        );
      });
    });

    it('clears clipboard after pasting cut items', async () => {
      mockClipboardState.items = [
        { id: 'file-3', objectType: 'file', name: 'cut-file.pdf' }
      ];
      mockClipboardState.operation = 'cut';

      vi.mocked(useVfsFolders).mockReturnValue({
        folders: [
          {
            id: 'folder-3',
            objectType: 'folder',
            name: 'Folder',
            parentId: null,
            childCount: 0,
            children: []
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      vi.mocked(useVfsFolderContents).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      render(<VfsExplorer selectedFolderId="folder-3" />);

      const emptyState = screen.getByText('This folder is empty');
      fireEvent.contextMenu(emptyState);
      fireEvent.click(screen.getByText('Paste'));

      await waitFor(() => {
        expect(mockClearClipboard).toHaveBeenCalled();
      });
    });

    it('does not show paste context menu on unfiled folder', () => {
      mockClipboardState.items = [
        { id: 'file-1', objectType: 'file', name: 'test.pdf' }
      ];
      mockClipboardState.operation = 'copy';

      render(<VfsExplorer />);

      // Default view is unfiled - should show "No unfiled items"
      expect(screen.getByText('No unfiled items')).toBeInTheDocument();

      // Right-click should NOT show Paste
      const emptyState = screen.getByText('No unfiled items');
      fireEvent.contextMenu(emptyState);

      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('does not paste a folder into itself', async () => {
      // Set up clipboard with the target folder itself
      mockClipboardState.items = [
        { id: 'folder-self', objectType: 'folder', name: 'Self Folder' }
      ];
      mockClipboardState.operation = 'copy';

      vi.mocked(useVfsFolders).mockReturnValue({
        folders: [
          {
            id: 'folder-self',
            objectType: 'folder',
            name: 'Self Folder',
            parentId: null,
            childCount: 0,
            children: []
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      vi.mocked(useVfsFolderContents).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      render(<VfsExplorer selectedFolderId="folder-self" />);

      const emptyState = screen.getByText('This folder is empty');
      fireEvent.contextMenu(emptyState);
      fireEvent.click(screen.getByText('Paste'));

      // copyItem should NOT be called (filtered out)
      await waitFor(() => {
        expect(mockCopyVfsItem.copyItem).not.toHaveBeenCalled();
      });
    });

    it('does not paste a contact container into itself', async () => {
      mockClipboardState.items = [
        { id: 'contact-self', objectType: 'contact', name: 'Self Contact' }
      ];
      mockClipboardState.operation = 'copy';

      vi.mocked(useVfsFolders).mockReturnValue({
        folders: [
          {
            id: 'contact-self',
            objectType: 'contact',
            name: 'Self Contact',
            parentId: null,
            childCount: 0,
            children: []
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      vi.mocked(useVfsFolderContents).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });

      render(<VfsExplorer selectedFolderId="contact-self" />);

      const emptyState = screen.getByText('This folder is empty');
      fireEvent.contextMenu(emptyState);
      fireEvent.click(screen.getByText('Paste'));

      await waitFor(() => {
        expect(mockCopyVfsItem.copyItem).not.toHaveBeenCalled();
      });
    });
  });
});
