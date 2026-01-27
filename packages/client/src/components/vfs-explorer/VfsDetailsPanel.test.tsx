import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsDetailsPanel } from './VfsDetailsPanel';

// Mock useVfsFolderContents hook
vi.mock('@/hooks/useVfsFolderContents', () => ({
  useVfsFolderContents: vi.fn()
}));

import { useVfsFolderContents } from '@/hooks/useVfsFolderContents';

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
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: mockItems,
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
  });

  it('shows placeholder when no folder is selected', () => {
    vi.mocked(useVfsFolderContents).mockReturnValue({
      items: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn()
    });
    render(<VfsDetailsPanel folderId={null} />);
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
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
});
