import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsExplorer } from './VfsExplorer';

// Mock useVfsFolders hook
vi.mock('@/hooks/useVfsFolders', () => ({
  useVfsFolders: vi.fn()
}));

// Mock useVfsFolderContents hook
vi.mock('@/hooks/useVfsFolderContents', () => ({
  useVfsFolderContents: vi.fn()
}));

import { useVfsFolderContents } from '@/hooks/useVfsFolderContents';
import { useVfsFolders } from '@/hooks/useVfsFolders';

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
