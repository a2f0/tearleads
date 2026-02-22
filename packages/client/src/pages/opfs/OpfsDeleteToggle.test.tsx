import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
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

describe('Opfs delete, toggle, and error handling', () => {
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
