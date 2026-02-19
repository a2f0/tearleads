import { fireEvent, render, screen } from '@testing-library/react';
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

import { useVfsFolderContents, useVfsUnfiledItems } from '../hooks';
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

describe('VfsDetailsPanel core behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('supports shift-click range selection', () => {
    const onItemSelectionChange = vi.fn();
    render(
      <VfsDetailsPanel
        folderId="1"
        selectedItemIds={['2']}
        selectionAnchorId="2"
        onItemSelectionChange={onItemSelectionChange}
      />
    );

    fireEvent.click(screen.getByText('document.pdf'), { shiftKey: true });

    expect(onItemSelectionChange).toHaveBeenCalledWith(['2', '3', '4'], '2');
  });

  it('supports ctrl-click toggle selection', () => {
    const onItemSelectionChange = vi.fn();
    render(
      <VfsDetailsPanel
        folderId="1"
        selectedItemIds={['2']}
        selectionAnchorId="2"
        onItemSelectionChange={onItemSelectionChange}
      />
    );

    fireEvent.click(screen.getByText('Meeting Notes'), { ctrlKey: true });

    expect(onItemSelectionChange).toHaveBeenCalledWith(['2', '3'], '3');
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
});
