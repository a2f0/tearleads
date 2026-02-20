import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockCanShareFiles,
  mockDb,
  mockDocuments,
  mockIsFileStorageInitialized,
  mockNavigate,
  mockSet,
  mockShareFile,
  mockStorage,
  mockUpdate,
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
  shareFile: (...args: unknown[]) => mockShareFile(...args)
}));

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: vi.fn()
}));

vi.mock('@/lib/chatAttachments', () => ({
  objectUrlToDataUrl: vi.fn()
}));

describe('Documents - Page Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('Documents')).toBeInTheDocument();
      });
    });

    it('shows back link by default', async () => {
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByTestId('back-link')).toBeInTheDocument();
      });
    });

    it('hides back link when showBackLink is false', async () => {
      await renderDocuments({ showBackLink: false });

      await waitFor(() => {
        expect(screen.getByText('Documents')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    });

    it('shows loading state when database is loading', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });

      await renderDocuments();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('shows inline unlock when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      await renderDocuments();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view documents./i
        )
      ).toBeInTheDocument();
    });
  });

  describe('document list', () => {
    it('renders document list when documents exist', async () => {
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
        expect(screen.getByText('another-document.pdf')).toBeInTheDocument();
      });
    });

    it('shows file size and upload date', async () => {
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      expect(screen.getByText(/1 KB/)).toBeInTheDocument();
    });

    it('shows document count', async () => {
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText(/2 documents$/)).toBeInTheDocument();
      });
    });
  });

  describe('table view', () => {
    it('renders table view when viewMode is table', async () => {
      await renderDocuments({ viewMode: 'table' });

      await waitFor(() => {
        expect(screen.getByTestId('documents-table')).toBeInTheDocument();
      });

      expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      expect(screen.queryByTestId('documents-list')).not.toBeInTheDocument();
    });

    it('shows empty table view message when no documents exist', async () => {
      mockDb.orderBy.mockResolvedValue([]);

      await renderDocuments({ viewMode: 'table' });

      await waitFor(() => {
        expect(
          screen.getByText('No documents yet. Use Upload to add documents.')
        ).toBeInTheDocument();
      });
    });

    it('renders document type labels in table view', async () => {
      await renderDocuments({ viewMode: 'table' });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      expect(screen.getAllByText('PDF').length).toBeGreaterThan(0);
    });

    it('sorts documents when table headers are clicked', async () => {
      const user = userEvent.setup();
      await renderDocuments({ viewMode: 'table' });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const rowsBefore = screen.getAllByRole('row');
      expect(rowsBefore[1]).toHaveTextContent('another-document.pdf');

      await user.click(screen.getByRole('button', { name: 'Size' }));

      const rowsAfter = screen.getAllByRole('row');
      expect(rowsAfter[1]).toHaveTextContent('test-document.pdf');

      await user.click(screen.getByRole('button', { name: 'Size' }));

      const rowsDesc = screen.getAllByRole('row');
      expect(rowsDesc[1]).toHaveTextContent('another-document.pdf');
    });

    it('supports downloads and shares in table view', async () => {
      mockCanShareFiles.mockReturnValue(true);
      const user = userEvent.setup();

      await renderDocuments({ viewMode: 'table' });

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      const downloadButtons = screen.getAllByTitle('Download');
      const shareButtons = screen.getAllByTitle('Share');

      await user.click(downloadButtons[0] as HTMLElement);
      await user.click(shareButtons[0] as HTMLElement);

      await waitFor(() => {
        expect(mockStorage.measureRetrieve).toHaveBeenCalledWith(
          '/documents/another-document.pdf',
          expect.any(Function)
        );
        expect(mockShareFile).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          'another-document.pdf',
          'application/pdf'
        );
      });
    });
  });

  describe('empty state', () => {
    it('shows full-width dropzone when no documents exist', async () => {
      mockDb.orderBy.mockResolvedValue([]);

      await renderDocuments();

      await waitFor(() => {
        expect(
          screen.getByText(/Drag and drop PDF or text documents here/)
        ).toBeInTheDocument();
      });

      expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();
    });

    it('shows empty message without dropzone when disabled', async () => {
      mockDb.orderBy.mockResolvedValue([]);

      await renderDocuments({ showDropzone: false });

      await waitFor(() => {
        expect(
          screen.getByText(/No documents yet\. Use Upload to add documents\./)
        ).toBeInTheDocument();
      });

      expect(screen.queryByTestId('dropzone-input')).not.toBeInTheDocument();
    });
  });

  describe('dropzone with existing documents', () => {
    it('shows compact dropzone in list when documents exist', async () => {
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();
    });
  });

  describe('refresh button', () => {
    it('renders refresh button when unlocked', async () => {
      await renderDocuments();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh/i })
        ).toBeInTheDocument();
      });
    });

    it('does not render refresh button when locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null
      });

      await renderDocuments();

      expect(
        screen.queryByRole('button', { name: /refresh/i })
      ).not.toBeInTheDocument();
    });

    it('refetches documents when refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderDocuments();

      await waitFor(() => {
        expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
      });

      mockDb.orderBy.mockClear();
      mockDb.orderBy.mockResolvedValue(mockDocuments);

      await user.click(screen.getByRole('button', { name: /refresh/i }));

      await waitFor(() => {
        expect(mockDb.orderBy).toHaveBeenCalled();
      });
    });
  });
});
