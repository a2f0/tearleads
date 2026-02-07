import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseState } from '../context';

// Mock the context
const mockDatabaseState: DatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('../context', () => ({
  useDatabaseState: () => mockDatabaseState,
  useVfsExplorerContext: () => ({
    ui: {
      ContextMenu: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="mock-context-menu">{children}</div>
      ),
      ContextMenuItem: ({
        children,
        onClick
      }: {
        children: React.ReactNode;
        onClick?: () => void;
      }) => (
        <button type="button" onClick={onClick}>
          {children}
        </button>
      )
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
  })
}));

// Mock the hooks
vi.mock('../hooks', () => ({
  useVfsFolderContents: vi.fn(),
  useVfsUnfiledItems: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn()
  })),
  useVfsAllItems: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn()
  })),
  useVfsSharedByMe: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn()
  })),
  useVfsSharedWithMe: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn()
  }))
}));

import { ALL_ITEMS_FOLDER_ID, UNFILED_FOLDER_ID } from '../constants';
import {
  useVfsAllItems,
  useVfsFolderContents,
  useVfsUnfiledItems
} from '../hooks';
import { VfsDetailsPanel } from './VfsDetailsPanel';

const mockItems = [
  {
    id: '1',
    linkId: 'link-1',
    objectType: 'folder' as const,
    name: 'Subfolder',
    createdAt: new Date('2024-01-01')
  },
  {
    id: '2',
    linkId: 'link-2',
    objectType: 'contact' as const,
    name: 'John Doe',
    createdAt: new Date('2024-01-02')
  },
  {
    id: '3',
    linkId: 'link-3',
    objectType: 'note' as const,
    name: 'Meeting Notes',
    createdAt: new Date('2024-01-03')
  },
  {
    id: '4',
    linkId: 'link-4',
    objectType: 'file' as const,
    name: 'document.pdf',
    createdAt: new Date('2024-01-04')
  },
  {
    id: '5',
    linkId: 'link-5',
    objectType: 'photo' as const,
    name: 'vacation.jpg',
    createdAt: new Date('2024-01-05')
  }
];

describe('VfsDetailsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset database state to unlocked by default
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDatabaseState.currentInstanceId = 'test-instance';
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: mockItems,
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
  });

  it('shows unfiled items view when no folder is selected', () => {
    vi.mocked(useVfsUnfiledItems).mockReturnValue({
      items: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
    render(<VfsDetailsPanel folderId={null} />);
    expect(screen.getByText('No unfiled items')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: [],
      loading: true,
      error: null,
      hasFetched: false,
      refetch: vi.fn()
    });
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.queryByText('5 items')).not.toBeInTheDocument();
  });

  it('shows error state', () => {
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: [],
      loading: false,
      error: 'Failed to load contents',
      hasFetched: true,
      refetch: vi.fn()
    });
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('Failed to load contents')).toBeInTheDocument();
  });

  it('shows empty state when folder has no items', () => {
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('This folder is empty')).toBeInTheDocument();
  });

  it('shows item count when folder is selected', () => {
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  it('renders items in list view by default', () => {
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('Subfolder')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
  });

  it('renders items in table view when specified', () => {
    render(<VfsDetailsPanel folderId="1" viewMode="table" />);

    expect(
      screen.getByRole('columnheader', { name: 'Name' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Type' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Created' })
    ).toBeInTheDocument();
  });

  it('shows folder items with correct types', () => {
    render(<VfsDetailsPanel folderId="1" viewMode="table" />);

    expect(screen.getByText('folder')).toBeInTheDocument();
    expect(screen.getByText('contact')).toBeInTheDocument();
    expect(screen.getByText('note')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
    expect(screen.getByText('photo')).toBeInTheDocument();
  });

  it('shows all mock item names', () => {
    render(<VfsDetailsPanel folderId="1" />);

    expect(screen.getByText('Subfolder')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
    expect(screen.getByText('vacation.jpg')).toBeInTheDocument();
  });

  it('displays plural item text for multiple items', () => {
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  it('displays singular item text for one item', () => {
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: mockItems.slice(0, 1),
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  describe('unfiled items', () => {
    it('shows unfiled items empty state', () => {
      vi.mocked(useVfsUnfiledItems).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={UNFILED_FOLDER_ID} />);
      expect(screen.getByText('No unfiled items')).toBeInTheDocument();
      expect(
        screen.getByText('Uploaded files will appear here until organized')
      ).toBeInTheDocument();
    });

    it('shows loading state for unfiled items', () => {
      vi.mocked(useVfsUnfiledItems).mockReturnValue({
        items: [],
        loading: true,
        error: null,
        hasFetched: false,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={UNFILED_FOLDER_ID} />);
      expect(screen.queryByText('No unfiled items')).not.toBeInTheDocument();
    });

    it('shows error state for unfiled items', () => {
      vi.mocked(useVfsUnfiledItems).mockReturnValue({
        items: [],
        loading: false,
        error: 'Failed to load unfiled items',
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={UNFILED_FOLDER_ID} />);
      expect(
        screen.getByText('Failed to load unfiled items')
      ).toBeInTheDocument();
    });

    it('shows unfiled items in list', () => {
      vi.mocked(useVfsUnfiledItems).mockReturnValue({
        items: [
          {
            id: 'unfiled-1',
            objectType: 'file',
            name: 'unfiled-document.pdf',
            createdAt: new Date('2024-01-10')
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={UNFILED_FOLDER_ID} />);
      expect(screen.getByText('unfiled-document.pdf')).toBeInTheDocument();
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });

    it('calls refetch when refreshToken changes', () => {
      const mockRefetch = vi.fn();
      vi.mocked(useVfsUnfiledItems).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: mockRefetch
      });

      const { rerender } = render(
        <VfsDetailsPanel folderId={UNFILED_FOLDER_ID} refreshToken={0} />
      );

      expect(mockRefetch).not.toHaveBeenCalled();

      rerender(
        <VfsDetailsPanel folderId={UNFILED_FOLDER_ID} refreshToken={1} />
      );

      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  it('calls folder contents refetch when refreshToken changes', () => {
    const mockRefetch = vi.fn();
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: mockRefetch
    });

    const { rerender } = render(
      <VfsDetailsPanel folderId="folder-1" refreshToken={0} />
    );

    expect(mockRefetch).not.toHaveBeenCalled();

    rerender(<VfsDetailsPanel folderId="folder-1" refreshToken={1} />);

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  describe('all items', () => {
    it('shows all items empty state', () => {
      vi.mocked(useVfsAllItems).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={ALL_ITEMS_FOLDER_ID} />);
      expect(screen.getByText('No items in registry')).toBeInTheDocument();
      expect(
        screen.getByText('Upload files to get started')
      ).toBeInTheDocument();
    });

    it('shows loading state for all items', () => {
      vi.mocked(useVfsAllItems).mockReturnValue({
        items: [],
        loading: true,
        error: null,
        hasFetched: false,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={ALL_ITEMS_FOLDER_ID} />);
      expect(
        screen.queryByText('No items in registry')
      ).not.toBeInTheDocument();
    });

    it('shows error state for all items', () => {
      vi.mocked(useVfsAllItems).mockReturnValue({
        items: [],
        loading: false,
        error: 'Failed to load all items',
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={ALL_ITEMS_FOLDER_ID} />);
      expect(screen.getByText('Failed to load all items')).toBeInTheDocument();
    });

    it('shows all items in list', () => {
      vi.mocked(useVfsAllItems).mockReturnValue({
        items: [
          {
            id: 'item-1',
            objectType: 'file',
            name: 'all-document.pdf',
            createdAt: new Date('2024-01-10')
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={ALL_ITEMS_FOLDER_ID} />);
      expect(screen.getByText('all-document.pdf')).toBeInTheDocument();
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });

    it('calls refetch when refreshToken changes', () => {
      const mockRefetch = vi.fn();
      vi.mocked(useVfsAllItems).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: mockRefetch
      });

      const { rerender } = render(
        <VfsDetailsPanel folderId={ALL_ITEMS_FOLDER_ID} refreshToken={0} />
      );

      expect(mockRefetch).not.toHaveBeenCalled();

      rerender(
        <VfsDetailsPanel folderId={ALL_ITEMS_FOLDER_ID} refreshToken={1} />
      );

      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });
});
