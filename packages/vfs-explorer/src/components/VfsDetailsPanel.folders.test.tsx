import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseState } from '../context';

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
  })),
  useVfsTrashItems: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn()
  }))
}));

import {
  ALL_ITEMS_FOLDER_ID,
  TRASH_FOLDER_ID,
  UNFILED_FOLDER_ID
} from '../constants';
import { useVfsAllItems, useVfsTrashItems, useVfsUnfiledItems } from '../hooks';
import { VfsDetailsPanel } from './VfsDetailsPanel';

describe('VfsDetailsPanel special folders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDatabaseState.currentInstanceId = 'test-instance';
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

  describe('trash items', () => {
    it('shows trash empty state', () => {
      vi.mocked(useVfsTrashItems).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={TRASH_FOLDER_ID} />);
      expect(screen.getByText('Trash is empty')).toBeInTheDocument();
      expect(
        screen.getByText('Items marked for deletion will appear here')
      ).toBeInTheDocument();
    });
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
