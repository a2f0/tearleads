import { ThemeProvider } from '@tearleads/ui';
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
vi.mock('@/lib/fileUtils', () => ({
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
vi.mock('@/lib/dataRetrieval', () => ({
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

function renderDocumentDetailWithProps(documentId: string, onBack: () => void) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/documents/${documentId}`]}>
        <Routes>
          <Route
            path="/documents/:id"
            element={<DocumentDetail documentId={documentId} onBack={onBack} />}
          />
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

  describe('delete handling', () => {
    it('calls onBack after delete when provided', async () => {
      const user = userEvent.setup();
      const onBack = vi.fn();
      renderDocumentDetailWithProps('doc-123', onBack);

      const deleteButton = await screen.findByTestId('delete-button');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
      expect(onBack).toHaveBeenCalledTimes(1);
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
