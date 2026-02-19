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

  const specialFolderCases = [
    {
      description: 'unfiled items',
      folderId: UNFILED_FOLDER_ID,
      useHook: useVfsUnfiledItems,
      emptyTitle: 'No unfiled items',
      emptyDescription: 'Uploaded files will appear here until organized',
      error: 'Failed to load unfiled items',
      itemId: 'unfiled-1',
      itemName: 'unfiled-document.pdf'
    },
    {
      description: 'all items',
      folderId: ALL_ITEMS_FOLDER_ID,
      useHook: useVfsAllItems,
      emptyTitle: 'No items in registry',
      emptyDescription: 'Upload files to get started',
      error: 'Failed to load all items',
      itemId: 'item-1',
      itemName: 'all-document.pdf'
    }
  ] as const;

  describe.each(specialFolderCases)('$description', (testCase) => {
    it('shows empty state', () => {
      vi.mocked(testCase.useHook).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={testCase.folderId} />);
      expect(screen.getByText(testCase.emptyTitle)).toBeInTheDocument();
      expect(screen.getByText(testCase.emptyDescription)).toBeInTheDocument();
    });

    it('shows loading state', () => {
      vi.mocked(testCase.useHook).mockReturnValue({
        items: [],
        loading: true,
        error: null,
        hasFetched: false,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={testCase.folderId} />);
      expect(screen.queryByText(testCase.emptyTitle)).not.toBeInTheDocument();
    });

    it('shows error state', () => {
      vi.mocked(testCase.useHook).mockReturnValue({
        items: [],
        loading: false,
        error: testCase.error,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={testCase.folderId} />);
      expect(screen.getByText(testCase.error)).toBeInTheDocument();
    });

    it('shows items in list', () => {
      vi.mocked(testCase.useHook).mockReturnValue({
        items: [
          {
            id: testCase.itemId,
            objectType: 'file',
            name: testCase.itemName,
            createdAt: new Date('2024-01-10')
          }
        ],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: vi.fn()
      });
      render(<VfsDetailsPanel folderId={testCase.folderId} />);
      expect(screen.getByText(testCase.itemName)).toBeInTheDocument();
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });

    it('calls refetch when refreshToken changes', () => {
      const mockRefetch = vi.fn();
      vi.mocked(testCase.useHook).mockReturnValue({
        items: [],
        loading: false,
        error: null,
        hasFetched: true,
        refetch: mockRefetch
      });

      const { rerender } = render(
        <VfsDetailsPanel folderId={testCase.folderId} refreshToken={0} />
      );

      expect(mockRefetch).not.toHaveBeenCalled();

      rerender(
        <VfsDetailsPanel folderId={testCase.folderId} refreshToken={1} />
      );

      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });
});
