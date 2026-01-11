import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDetail } from './DocumentDetail';

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate
  })
}));

const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

const mockRetrieve = vi.fn();
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
}));

const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
const mockCanShareFiles = vi.fn();
vi.mock('@/lib/file-utils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  shareFile: (data: Uint8Array, filename: string, mimeType: string) =>
    mockShareFile(data, filename, mimeType),
  canShareFiles: () => mockCanShareFiles()
}));

vi.mock('@/components/pdf', () => ({
  PdfViewer: ({ data }: { data: Uint8Array }) => (
    <div data-testid="mock-pdf-viewer">PDF Viewer ({data.length} bytes)</div>
  )
}));

const mockRetrieveFileData = vi.fn();
vi.mock('@/lib/data-retrieval', () => ({
  retrieveFileData: (storagePath: string, instanceId: string) =>
    mockRetrieveFileData(storagePath, instanceId)
}));

const TEST_DOCUMENT = {
  id: 'doc-123',
  name: 'test-document.pdf',
  size: 1024,
  mimeType: 'application/pdf',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/documents/test-document.pdf'
};

const TEST_PDF_DATA = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF header
const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result)
      })
    })
  };
}

function renderDocumentDetailRaw(documentId: string = 'doc-123') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/documents/${documentId}`]}>
        <Routes>
          <Route path="/documents/:id" element={<DocumentDetail />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function renderDocumentDetail(documentId: string = 'doc-123') {
  const result = renderDocumentDetailRaw(documentId);
  await waitFor(() => {
    expect(screen.queryByText('Loading document...')).not.toBeInTheDocument();
  });
  return result;
}

describe('DocumentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_PDF_DATA);
    mockRetrieveFileData.mockResolvedValue(TEST_PDF_DATA);
    mockSelect.mockReturnValue(createMockQueryChain([TEST_DOCUMENT]));
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })
    });
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockResolvedValue(true);
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });
    });

    it('shows loading message', () => {
      renderDocumentDetailRaw();
      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });
  });

  describe('when database is locked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });
    });

    it('shows inline unlock component', () => {
      renderDocumentDetailRaw();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view this document./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderDocumentDetailRaw();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderDocumentDetailRaw();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });
  });

  describe('when document is loaded', () => {
    it('renders document name', async () => {
      await renderDocumentDetail();

      expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
    });

    it('renders document details', async () => {
      await renderDocumentDetail();

      expect(screen.getByText('application/pdf')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument();
    });

    it('renders download button', async () => {
      await renderDocumentDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
    });

    it('renders share button when Web Share API is supported', async () => {
      mockCanShareFiles.mockReturnValue(true);
      await renderDocumentDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();
    });

    it('hides share button when Web Share API is not supported', async () => {
      mockCanShareFiles.mockReturnValue(false);
      await renderDocumentDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
      expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
    });
  });

  describe('download functionality', () => {
    it('downloads file when download button is clicked', async () => {
      const user = userEvent.setup();
      await renderDocumentDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(mockRetrieveFileData).toHaveBeenCalledWith(
          '/documents/test-document.pdf',
          'test-instance'
        );
        expect(mockDownloadFile).toHaveBeenCalledWith(
          TEST_PDF_DATA,
          'test-document.pdf'
        );
      });
    });

    it('shows error when download fails', async () => {
      mockRetrieveFileData.mockRejectedValueOnce(
        new Error('Storage read failed')
      );
      const user = userEvent.setup();
      await renderDocumentDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(screen.getByText('Storage read failed')).toBeInTheDocument();
      });
    });
  });

  describe('share functionality', () => {
    it('shares file when share button is clicked', async () => {
      const user = userEvent.setup();
      await renderDocumentDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(mockRetrieveFileData).toHaveBeenCalledWith(
          '/documents/test-document.pdf',
          'test-instance'
        );
        expect(mockShareFile).toHaveBeenCalledWith(
          TEST_PDF_DATA,
          'test-document.pdf',
          'application/pdf'
        );
      });
    });

    it('handles share cancellation gracefully', async () => {
      const abortError = new Error('User cancelled');
      abortError.name = 'AbortError';
      mockShareFile.mockRejectedValue(abortError);

      const user = userEvent.setup();
      await renderDocumentDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(mockShareFile).toHaveBeenCalled();
      });

      expect(screen.queryByText('User cancelled')).not.toBeInTheDocument();
    });

    it('shows error when share fails', async () => {
      mockShareFile.mockRejectedValue(new Error('Share failed'));
      const user = userEvent.setup();
      await renderDocumentDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(screen.getByText('Share failed')).toBeInTheDocument();
      });
    });

    it('shows error when sharing is not supported on device', async () => {
      mockShareFile.mockResolvedValue(false);
      const user = userEvent.setup();
      await renderDocumentDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(
          screen.getByText('Sharing is not supported on this device')
        ).toBeInTheDocument();
      });
    });
  });

  describe('document not found', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows not found error', async () => {
      await renderDocumentDetail();

      expect(screen.getByText('Document not found')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows error when fetch fails', async () => {
      const errorQueryChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Database error'))
          })
        })
      };
      mockSelect.mockReturnValue(errorQueryChain);

      await renderDocumentDetail();

      expect(screen.getByText('Database error')).toBeInTheDocument();
    });

    it('handles non-Error objects in catch block', async () => {
      const errorQueryChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue('String error')
          })
        })
      };
      mockSelect.mockReturnValue(errorQueryChain);

      await renderDocumentDetail();

      expect(screen.getByText('String error')).toBeInTheDocument();
    });
  });

  describe('back navigation', () => {
    it('renders back link to documents page', async () => {
      await renderDocumentDetail();

      const backLink = screen.getByTestId('back-link');
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/documents');
      expect(backLink).toHaveTextContent('Back to Documents');
    });
  });

  describe('name editing', () => {
    it('renders edit button for document name', async () => {
      await renderDocumentDetail();

      expect(screen.getByTestId('document-title-edit')).toBeInTheDocument();
    });

    it('enters edit mode when edit button is clicked', async () => {
      const user = userEvent.setup();
      await renderDocumentDetail();

      await user.click(screen.getByTestId('document-title-edit'));

      expect(screen.getByTestId('document-title-input')).toBeInTheDocument();
      expect(screen.getByTestId('document-title-input')).toHaveValue(
        'test-document.pdf'
      );
    });

    it('updates document name when saved', async () => {
      const user = userEvent.setup();
      await renderDocumentDetail();

      await user.click(screen.getByTestId('document-title-edit'));
      await user.clear(screen.getByTestId('document-title-input'));
      await user.type(
        screen.getByTestId('document-title-input'),
        'new-name.pdf'
      );
      await user.click(screen.getByTestId('document-title-save'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('cancels edit mode when cancel button is clicked', async () => {
      const user = userEvent.setup();
      await renderDocumentDetail();

      await user.click(screen.getByTestId('document-title-edit'));
      await user.clear(screen.getByTestId('document-title-input'));
      await user.type(
        screen.getByTestId('document-title-input'),
        'new-name.pdf'
      );
      await user.click(screen.getByTestId('document-title-cancel'));

      expect(
        screen.queryByTestId('document-title-input')
      ).not.toBeInTheDocument();
      expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
    });
  });
});
