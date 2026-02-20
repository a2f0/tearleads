import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockCanShareFiles,
  mockDb,
  mockDocuments,
  mockIsFileStorageInitialized,
  mockNavigate,
  mockSet,
  mockStorage,
  mockUpdate,
  mockUpdateWhere,
  mockUseDatabaseContext,
  renderDocuments,
  screen,
  setupDefaultMocks
} from './Documents.testSetup';

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn()
  }))
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => mockDb)
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({
    getCurrentKey: vi.fn(() => new Uint8Array(32))
  }))
}));

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: vi.fn(),
  getFileStorage: vi.fn(() => mockStorage),
  createRetrieveLogger: () => vi.fn()
}));

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() })
}));

vi.mock('@/lib/fileUtils', () => ({
  canShareFiles: () => mockCanShareFiles(),
  downloadFile: vi.fn(),
  shareFile: vi.fn()
}));

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: vi.fn()
}));

vi.mock('@/lib/chatAttachments', () => ({
  objectUrlToDataUrl: vi.fn()
}));

describe('Documents - Context Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('context menu', () => {
    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });
    });

    it('navigates to document detail when "Get info" is clicked', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Get info'));

      expect(mockNavigate).toHaveBeenCalledWith('/documents/doc-1', {
        state: { from: '/', fromLabel: 'Back to Documents' }
      });
    });

    it('closes context menu when clicking elsewhere', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole('button', { name: /close context menu/i })
      );

      await waitFor(() => {
        expect(screen.queryByText('Get info')).not.toBeInTheDocument();
      });
    });

    it('shows "Delete" option in context menu', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });

    it('shows "Restore" option for deleted documents', async () => {
      const user = userEvent.setup();
      mockDb.orderBy.mockResolvedValue([
        {
          ...mockDocuments[0],
          deleted: true
        }
      ]);

      await renderDocuments({ showDeleted: true });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Restore')).toBeInTheDocument();
      });
    });

    it('opens AI chat from context menu', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });
      await user.click(screen.getByText('Add to AI chat'));

      expect(mockNavigate).toHaveBeenCalledWith('/chat', {
        state: { from: '/', fromLabel: 'Back to Documents' }
      });
    });

    it('soft deletes document when "Delete" is clicked', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledWith({ deleted: true });
      });
    });

    it('restores document when "Restore" is clicked', async () => {
      const user = userEvent.setup();
      mockDb.orderBy.mockResolvedValue([
        {
          ...mockDocuments[0],
          deleted: true
        }
      ]);

      await renderDocuments({ showDeleted: true });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Restore')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Restore'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledWith({ deleted: false });
      });
    });

    it('shows error when delete fails', async () => {
      const user = userEvent.setup();
      mockUpdateWhere.mockRejectedValue(new Error('Delete failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions when delete fails', async () => {
      const user = userEvent.setup();
      mockUpdateWhere.mockRejectedValue('String error');

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('triggers refetch after successful delete', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      // Clear to track refetch
      mockDb.orderBy.mockClear();

      await user.click(screen.getByText('Delete'));

      // Flush the setTimeout for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => {
        expect(mockDb.orderBy).toHaveBeenCalled();
      });
    });
  });

  describe('document click navigation', () => {
    it('navigates to document detail on click', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByText('test-document.pdf'));

      expect(mockNavigate).toHaveBeenCalledWith('/documents/doc-1', {
        state: { from: '/', fromLabel: 'Back to Documents' }
      });
    });

    it('uses onSelectDocument when provided', async () => {
      const user = userEvent.setup();
      const onSelectDocument = vi.fn();
      await renderDocuments({ onSelectDocument });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByText('test-document.pdf'));

      expect(onSelectDocument).toHaveBeenCalledWith('doc-1');
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('context menu selection', () => {
    it('uses onSelectDocument for Get info when provided', async () => {
      const user = userEvent.setup();
      const onSelectDocument = vi.fn();
      await renderDocuments({ onSelectDocument });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const document = screen.getByText('test-document.pdf');
      await user.pointer({ keys: '[MouseRight]', target: document });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Get info'));

      expect(onSelectDocument).toHaveBeenCalledWith('doc-1');
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('blank space context menu', () => {
    it('shows upload context menu on right-click when onUpload is provided', async () => {
      const mockOnUpload = vi.fn();
      await renderDocuments({ onUpload: mockOnUpload });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      // Find the scroll container with the list and right-click
      const scrollContainer = screen
        .getByText('test-document.pdf')
        .closest('[class*="overflow-auto"]');
      expect(scrollContainer).toBeInTheDocument();

      if (scrollContainer) {
        await act(async () => {
          scrollContainer.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: 100,
              clientY: 200
            })
          );
        });
      }

      await waitFor(() => {
        expect(screen.getByText('Upload')).toBeInTheDocument();
      });
    });

    it('calls onUpload when upload menu item is clicked', async () => {
      const user = userEvent.setup();
      const mockOnUpload = vi.fn();
      await renderDocuments({ onUpload: mockOnUpload });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      // Find the scroll container and right-click
      const scrollContainer = screen
        .getByText('test-document.pdf')
        .closest('[class*="overflow-auto"]');

      if (scrollContainer) {
        await act(async () => {
          scrollContainer.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: 100,
              clientY: 200
            })
          );
        });
      }

      await waitFor(() => {
        expect(screen.getByText('Upload')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Upload'));

      expect(mockOnUpload).toHaveBeenCalled();
    });
  });
});
