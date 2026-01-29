import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the hooks
vi.mock('../hooks', () => ({
  useVfsFolders: vi.fn(),
  useVfsFolderContents: vi.fn(),
  useVfsUnfiledItems: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn()
  })),
  useMoveVfsItem: vi.fn(() => ({
    moveItem: vi.fn(),
    isMoving: false,
    error: null
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
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<VfsExplorer className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders with list view mode by default', () => {
    render(<VfsExplorer />);
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
  });

  it('renders with table view mode when specified', () => {
    render(<VfsExplorer viewMode="table" />);
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
  });
});
