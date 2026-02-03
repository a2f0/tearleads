import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    clipboard: { items: [], operation: null },
    cut: vi.fn(),
    copy: vi.fn(),
    clear: vi.fn(),
    hasItems: false,
    isCut: false,
    isCopy: false
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

// Mock the hooks
vi.mock('../hooks', () => ({
  useVfsFolders: vi.fn(),
  useVfsFolderContents: vi.fn(),
  useVfsUnfiledItems: vi.fn(() => mockUnfiledItems),
  useVfsAllItems: vi.fn(() => mockAllItems),
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
});
