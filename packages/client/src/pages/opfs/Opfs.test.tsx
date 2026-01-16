import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { Opfs } from './Opfs';

// Store original navigator.storage
const originalStorage = navigator.storage;

// Mock FileSystemFileHandle
class MockFileSystemFileHandle {
  readonly kind = 'file' as const;
  constructor(
    public name: string,
    private size: number
  ) {}
  async getFile() {
    return { size: this.size };
  }
}

// Mock FileSystemDirectoryHandle
class MockFileSystemDirectoryHandle {
  readonly kind = 'directory' as const;
  private _entries: Map<
    string,
    MockFileSystemFileHandle | MockFileSystemDirectoryHandle
  >;

  constructor(
    public name: string,
    entries: Map<
      string,
      MockFileSystemFileHandle | MockFileSystemDirectoryHandle
    >
  ) {
    this._entries = entries;
  }

  entries(): AsyncIterable<
    [string, MockFileSystemFileHandle | MockFileSystemDirectoryHandle]
  > {
    const entriesMap = this._entries;
    return {
      [Symbol.asyncIterator]() {
        const iterator = entriesMap.entries();
        return {
          async next() {
            const result = iterator.next();
            if (result.done) {
              return { done: true as const, value: undefined };
            }
            return { done: false as const, value: result.value };
          }
        };
      }
    };
  }

  async getDirectoryHandle(name: string) {
    const handle = this._entries.get(name);
    if (handle && handle.kind === 'directory') {
      return handle;
    }
    throw new Error(`Directory not found: ${name}`);
  }

  removeEntry = vi.fn(
    async (_name: string, _options?: { recursive?: boolean }) => {
      // Mock implementation
    }
  );
}

function createMockRootDirectory(
  entries: Map<
    string,
    MockFileSystemFileHandle | MockFileSystemDirectoryHandle
  > = new Map()
) {
  return new MockFileSystemDirectoryHandle('root', entries);
}

function renderOpfs() {
  return render(
    <MemoryRouter>
      <Opfs />
    </MemoryRouter>
  );
}

function mockNavigatorStorage(storage: StorageManager | undefined) {
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    writable: true,
    configurable: true
  });
}

describe('Opfs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original navigator.storage
    Object.defineProperty(navigator, 'storage', {
      value: originalStorage,
      writable: true,
      configurable: true
    });
  });

  describe('when OPFS is not supported', () => {
    beforeEach(() => {
      // Mock storage without getDirectory to trigger not supported
      mockNavigatorStorage({} as StorageManager);
    });

    it('shows not supported message', async () => {
      renderOpfs();

      await waitFor(() => {
        expect(
          screen.getByText(
            'Origin Private File System is not supported in this browser.'
          )
        ).toBeInTheDocument();
      });
    });
  });

  describe('when OPFS is supported but empty', () => {
    beforeEach(() => {
      const mockRoot = createMockRootDirectory();
      mockNavigatorStorage({
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 5368709120 })
      } as unknown as StorageManager);
    });

    it('shows empty state message', async () => {
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('OPFS is empty.')).toBeInTheDocument();
      });
    });

    it('shows storage capacity when empty', async () => {
      renderOpfs();

      await waitFor(() => {
        // 0 B / 5 GB total capacity
        expect(
          screen.getByText(/0 B \/ 5 GB total capacity/)
        ).toBeInTheDocument();
      });
    });
  });

  describe('when OPFS has files', () => {
    beforeEach(() => {
      const entries = new Map<
        string,
        MockFileSystemFileHandle | MockFileSystemDirectoryHandle
      >();
      entries.set('file1.txt', new MockFileSystemFileHandle('file1.txt', 1024));
      entries.set('file2.txt', new MockFileSystemFileHandle('file2.txt', 2048));

      const subEntries = new Map<
        string,
        MockFileSystemFileHandle | MockFileSystemDirectoryHandle
      >();
      subEntries.set(
        'nested.txt',
        new MockFileSystemFileHandle('nested.txt', 512)
      );
      entries.set(
        'subdir',
        new MockFileSystemDirectoryHandle('subdir', subEntries)
      );

      const mockRoot = createMockRootDirectory(entries);
      mockNavigatorStorage({
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
        estimate: vi
          .fn()
          .mockResolvedValue({ usage: 10485760, quota: 5368709120 })
      } as unknown as StorageManager);
    });

    it('renders the page title', async () => {
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('OPFS Browser')).toBeInTheDocument();
      });
    });

    it('displays file count and total size', async () => {
      renderOpfs();

      await waitFor(() => {
        // 3 files: file1.txt (1024), file2.txt (2048), nested.txt (512) = 3584 bytes = 3.5 KB
        expect(screen.getByText(/3 files \(3\.5 KB\)/)).toBeInTheDocument();
      });
    });

    it('displays storage capacity', async () => {
      renderOpfs();

      await waitFor(() => {
        // 10 MB usage / 5 GB quota
        expect(
          screen.getByText(/10 MB \/ 5 GB total capacity/)
        ).toBeInTheDocument();
      });
    });

    it('displays files in the tree', async () => {
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('file1.txt')).toBeInTheDocument();
        expect(screen.getByText('file2.txt')).toBeInTheDocument();
        expect(screen.getByText('subdir')).toBeInTheDocument();
      });
    });

    it('shows file sizes', async () => {
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('1 KB')).toBeInTheDocument();
        expect(screen.getByText('2 KB')).toBeInTheDocument();
      });
    });

    it('expands directories by default', async () => {
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('nested.txt')).toBeInTheDocument();
      });
    });
  });

  describe('storage estimate edge cases', () => {
    it('handles missing storage estimate gracefully', async () => {
      const mockRoot = createMockRootDirectory();
      mockNavigatorStorage({
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
        estimate: vi.fn().mockResolvedValue({})
      } as unknown as StorageManager);

      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('OPFS is empty.')).toBeInTheDocument();
      });

      // Should not show capacity when estimate is incomplete
      expect(screen.queryByText(/total capacity/)).not.toBeInTheDocument();
    });

    it('handles estimate function not available', async () => {
      const mockRoot = createMockRootDirectory();
      mockNavigatorStorage({
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
        estimate: undefined
      } as unknown as StorageManager);

      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('OPFS is empty.')).toBeInTheDocument();
      });

      // Should not show capacity when estimate is not available
      expect(screen.queryByText(/total capacity/)).not.toBeInTheDocument();
    });
  });

  describe('refresh functionality', () => {
    it('refreshes content when refresh button is clicked', async () => {
      const mockGetDirectory = vi.fn();
      const mockRoot = createMockRootDirectory();
      mockGetDirectory.mockResolvedValue(mockRoot);

      mockNavigatorStorage({
        getDirectory: mockGetDirectory,
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 5368709120 })
      } as unknown as StorageManager);

      const user = userEvent.setup();
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('OPFS Browser')).toBeInTheDocument();
      });

      expect(mockGetDirectory).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /refresh/i }));

      await waitFor(() => {
        expect(mockGetDirectory).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('singular/plural file count', () => {
    it('shows singular "file" for 1 file', async () => {
      const entries = new Map<
        string,
        MockFileSystemFileHandle | MockFileSystemDirectoryHandle
      >();
      entries.set(
        'single.txt',
        new MockFileSystemFileHandle('single.txt', 100)
      );

      const mockRoot = createMockRootDirectory(entries);
      mockNavigatorStorage({
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
        estimate: vi.fn().mockResolvedValue({ usage: 100, quota: 5368709120 })
      } as unknown as StorageManager);

      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText(/1 file \(100 B\)/)).toBeInTheDocument();
      });
    });
  });

  describe('directory toggle functionality', () => {
    beforeEach(() => {
      const subEntries = new Map<
        string,
        MockFileSystemFileHandle | MockFileSystemDirectoryHandle
      >();
      subEntries.set(
        'nested.txt',
        new MockFileSystemFileHandle('nested.txt', 512)
      );
      const entries = new Map<
        string,
        MockFileSystemFileHandle | MockFileSystemDirectoryHandle
      >();
      entries.set(
        'folder',
        new MockFileSystemDirectoryHandle('folder', subEntries)
      );

      const mockRoot = createMockRootDirectory(entries);
      mockNavigatorStorage({
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
        estimate: vi.fn().mockResolvedValue({ usage: 512, quota: 5368709120 })
      } as unknown as StorageManager);
    });

    it('collapses directory when clicked', async () => {
      const user = userEvent.setup();
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument();
        expect(screen.getByText('nested.txt')).toBeInTheDocument();
      });

      // Click the directory to collapse it
      const folderButton = screen.getByRole('button', { name: /folder/i });
      await user.click(folderButton);

      await waitFor(() => {
        expect(screen.queryByText('nested.txt')).not.toBeInTheDocument();
      });
    });

    it('expands directory when clicked again', async () => {
      const user = userEvent.setup();
      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('nested.txt')).toBeInTheDocument();
      });

      // Click to collapse
      const folderButton = screen.getByRole('button', { name: /folder/i });
      await user.click(folderButton);

      await waitFor(() => {
        expect(screen.queryByText('nested.txt')).not.toBeInTheDocument();
      });

      // Click to expand again
      await user.click(folderButton);

      await waitFor(() => {
        expect(screen.getByText('nested.txt')).toBeInTheDocument();
      });
    });
  });

  describe('delete functionality', () => {
    describe('file deletion', () => {
      let mockRoot: MockFileSystemDirectoryHandle;

      beforeEach(() => {
        const entries = new Map<
          string,
          MockFileSystemFileHandle | MockFileSystemDirectoryHandle
        >();
        entries.set('file.txt', new MockFileSystemFileHandle('file.txt', 1024));

        mockRoot = createMockRootDirectory(entries);
        mockRoot.removeEntry.mockResolvedValue(undefined);

        mockNavigatorStorage({
          getDirectory: vi.fn().mockResolvedValue(mockRoot),
          estimate: vi
            .fn()
            .mockResolvedValue({ usage: 1024, quota: 5368709120 })
        } as unknown as StorageManager);
      });

      it('shows confirmation dialog when deleting a file', async () => {
        const user = userEvent.setup();
        renderOpfs();

        await waitFor(() => {
          expect(screen.getByText('file.txt')).toBeInTheDocument();
        });

        // Find and click the delete button for file.txt
        const deleteButton = screen.getByTitle('Delete');
        await user.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
          expect(
            screen.getByText(/Are you sure you want to delete the file/)
          ).toBeInTheDocument();
        });
      });

      it('does not delete when confirmation is cancelled', async () => {
        const user = userEvent.setup();
        renderOpfs();

        await waitFor(() => {
          expect(screen.getByText('file.txt')).toBeInTheDocument();
        });

        const deleteButton = screen.getByTitle('Delete');
        await user.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        });

        await user.click(screen.getByTestId('confirm-dialog-cancel'));

        await waitFor(() => {
          expect(
            screen.queryByTestId('confirm-dialog')
          ).not.toBeInTheDocument();
        });

        expect(mockRoot.removeEntry).not.toHaveBeenCalled();
      });

      it('deletes file when confirmation is accepted', async () => {
        const user = userEvent.setup();
        renderOpfs();

        await waitFor(() => {
          expect(screen.getByText('file.txt')).toBeInTheDocument();
        });

        const deleteButton = screen.getByTitle('Delete');
        await user.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        });

        await user.click(screen.getByTestId('confirm-dialog-confirm'));

        await waitFor(() => {
          expect(mockRoot.removeEntry).toHaveBeenCalledWith('file.txt', {
            recursive: false
          });
        });
      });
    });

    describe('directory deletion', () => {
      let mockRoot: MockFileSystemDirectoryHandle;

      beforeEach(() => {
        const entries = new Map<
          string,
          MockFileSystemFileHandle | MockFileSystemDirectoryHandle
        >();
        entries.set(
          'mydir',
          new MockFileSystemDirectoryHandle('mydir', new Map())
        );

        mockRoot = createMockRootDirectory(entries);
        mockRoot.removeEntry.mockResolvedValue(undefined);

        mockNavigatorStorage({
          getDirectory: vi.fn().mockResolvedValue(mockRoot),
          estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 5368709120 })
        } as unknown as StorageManager);
      });

      it('shows confirmation dialog when deleting a directory', async () => {
        const user = userEvent.setup();
        renderOpfs();

        await waitFor(() => {
          expect(screen.getByText('mydir')).toBeInTheDocument();
        });

        const deleteButton = screen.getByTitle('Delete');
        await user.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
          expect(
            screen.getByText(/Are you sure you want to delete the directory/)
          ).toBeInTheDocument();
        });
      });

      it('deletes directory recursively when confirmation is accepted', async () => {
        const user = userEvent.setup();
        renderOpfs();

        await waitFor(() => {
          expect(screen.getByText('mydir')).toBeInTheDocument();
        });

        const deleteButton = screen.getByTitle('Delete');
        await user.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        });

        await user.click(screen.getByTestId('confirm-dialog-confirm'));

        await waitFor(() => {
          expect(mockRoot.removeEntry).toHaveBeenCalledWith('mydir', {
            recursive: true
          });
        });
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when OPFS read fails', async () => {
      const consoleSpy = mockConsoleError();
      mockNavigatorStorage({
        getDirectory: vi.fn().mockRejectedValue(new Error('Access denied')),
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 5368709120 })
      } as unknown as StorageManager);

      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('Access denied')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read OPFS:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('displays error message when delete fails', async () => {
      const consoleSpy = mockConsoleError();
      const user = userEvent.setup();

      const entries = new Map<
        string,
        MockFileSystemFileHandle | MockFileSystemDirectoryHandle
      >();
      entries.set('file.txt', new MockFileSystemFileHandle('file.txt', 1024));

      const mockRoot = createMockRootDirectory(entries);
      mockRoot.removeEntry.mockRejectedValue(new Error('Delete failed'));

      mockNavigatorStorage({
        getDirectory: vi.fn().mockResolvedValue(mockRoot),
        estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 5368709120 })
      } as unknown as StorageManager);

      renderOpfs();

      await waitFor(() => {
        expect(screen.getByText('file.txt')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
