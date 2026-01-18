import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpfsBrowserHandle } from './OpfsBrowser';
import { OpfsBrowser } from './OpfsBrowser';

vi.mock('./opfs-utils', () => ({
  readDirectory: vi.fn().mockResolvedValue([
    { name: 'folder1', type: 'directory', children: [] },
    { name: 'file1.txt', type: 'file', size: 100 }
  ]),
  collectAllPaths: vi.fn().mockReturnValue(['folder1']),
  countFiles: vi.fn().mockReturnValue(1),
  calculateTotalSize: vi.fn().mockReturnValue(100)
}));

vi.mock('@/lib/utils', () => ({
  formatFileSize: vi.fn().mockReturnValue('100 B'),
  cn: (...classes: string[]) => classes.filter(Boolean).join(' ')
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: () => null
}));

vi.mock('@/components/ui/refresh-button', () => ({
  RefreshButton: ({
    onClick,
    isLoading
  }: {
    onClick: () => void;
    isLoading?: boolean;
  }) => (
    <button type="button" onClick={onClick} data-testid="refresh-button">
      {isLoading ? 'Loading' : 'Refresh'}
    </button>
  )
}));

vi.mock('./TreeNode', () => ({
  TreeNode: () => <div data-testid="tree-node">TreeNode</div>
}));

describe('OpfsBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock navigator.storage.estimate
    Object.defineProperty(navigator, 'storage', {
      value: {
        estimate: vi.fn().mockResolvedValue({
          usage: 1000,
          quota: 10000
        }),
        getDirectory: vi.fn().mockResolvedValue({})
      },
      writable: true
    });
  });

  it('renders with header by default', async () => {
    render(<OpfsBrowser />);
    await waitFor(() => {
      expect(screen.getByText('OPFS Browser')).toBeInTheDocument();
    });
  });

  it('renders without header when showHeader is false', async () => {
    render(<OpfsBrowser showHeader={false} />);
    await waitFor(() => {
      expect(screen.queryByText('OPFS Browser')).not.toBeInTheDocument();
    });
  });

  it('exposes refresh method via ref', async () => {
    const ref = createRef<OpfsBrowserHandle>();
    render(<OpfsBrowser ref={ref} />);

    await waitFor(() => {
      expect(ref.current).toBeDefined();
    });

    expect(ref.current?.refresh).toBeDefined();
    await act(async () => {
      ref.current?.refresh();
    });
  });

  it('exposes expandAll method via ref', async () => {
    const ref = createRef<OpfsBrowserHandle>();
    render(<OpfsBrowser ref={ref} />);

    await waitFor(() => {
      expect(ref.current).toBeDefined();
    });

    expect(ref.current?.expandAll).toBeDefined();
    act(() => {
      ref.current?.expandAll();
    });
  });

  it('exposes collapseAll method via ref', async () => {
    const ref = createRef<OpfsBrowserHandle>();
    render(<OpfsBrowser ref={ref} />);

    await waitFor(() => {
      expect(ref.current).toBeDefined();
    });

    expect(ref.current?.collapseAll).toBeDefined();
    act(() => {
      ref.current?.collapseAll();
    });
  });
});
