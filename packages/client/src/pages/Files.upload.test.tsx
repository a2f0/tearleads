import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockQueryChain,
  createMockUpdateChain,
  renderFiles,
  renderFilesRaw,
  TEST_ENCRYPTION_KEY,
  TEST_FILE_WITH_THUMBNAIL,
  TEST_FILE_WITHOUT_THUMBNAIL,
  TEST_THUMBNAIL_DATA
} from './Files.testSetup';

// ============================================
// Define mocks before vi.mock calls (vi.mock is hoisted)
// ============================================

const mockUseDatabaseContext = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockGetCurrentKey = vi.fn();
const mockRetrieve = vi.fn();
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
const mockUploadFile = vi.fn();

// ============================================
// vi.mock calls - these are hoisted to the top
// ============================================

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((options: { count: number } & Record<string, unknown>) => {
    const getScrollElement = options['getScrollElement'];
    if (typeof getScrollElement === 'function') {
      getScrollElement();
    }
    const estimateSize = options['estimateSize'];
    if (typeof estimateSize === 'function') {
      estimateSize();
    }
    const { count } = options;
    return {
      getVirtualItems: Object.assign(
        () =>
          Array.from({ length: count }, (_, i) => ({
            index: i,
            start: i * 56,
            end: (i + 1) * 56,
            size: 56,
            key: i,
            lane: 0
          })),
        { updateDeps: vi.fn() }
      ),
      getTotalSize: () => count * 56,
      measureElement: vi.fn()
    };
  })
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn()
  };
});

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate
  })
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve,
    store: vi.fn()
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(key, instanceId),
  createRetrieveLogger: () => vi.fn()
}));

vi.mock('@/lib/fileUtils', () => ({
  downloadFile: vi.fn(),
  computeContentHash: vi.fn().mockResolvedValue('mock-hash'),
  readFileAsUint8Array: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
}));

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

vi.mock('@/audio', () => ({
  useAudio: () => ({
    currentTrack: null,
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  })
}));

vi.mock('@/lib/dataRetrieval', () => ({
  retrieveFileData: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
}));

vi.mock('@/hooks/app', () => ({
  useOnInstanceChange: vi.fn()
}));

// ============================================
// Tests
// ============================================

describe('Files - Upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_THUMBNAIL_DATA);
    mockUploadFile.mockReset();
    mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
    mockSelect.mockReturnValue(
      createMockQueryChain([TEST_FILE_WITH_THUMBNAIL, TEST_FILE_WITHOUT_THUMBNAIL])
    );
    mockUpdate.mockReturnValue(createMockUpdateChain());
  });

  describe('upload success badge', () => {
    it('does not show success badge initially', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });
  });

  describe('file upload progress', () => {
    it('renders dropzone for file uploads', async () => {
      await renderFiles();

      const dropzones = screen.getAllByTestId('dropzone');
      expect(dropzones[0]).toBeInTheDocument();

      expect(
        screen.getByText(/Drag and drop files here/i)
      ).toBeInTheDocument();
    });

    it('hides dropzone when database is locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderFilesRaw();

      expect(screen.queryByTestId('dropzone')).not.toBeInTheDocument();
    });
  });

  describe('recently uploaded badge', () => {
    it('does not show success badge for existing files', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });
  });

  describe('file upload flow', () => {
    it('does not process uploads when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderFilesRaw();

      expect(screen.queryByTestId('dropzone')).not.toBeInTheDocument();
    });

    it('uploads files, tracks progress, and shows success badge', async () => {
      const user = userEvent.setup();
      const file = new File(['hello'], 'upload.txt', { type: 'text/plain' });
      let resolveUpload:
        | ((value: { id: string; isDuplicate: boolean }) => void)
        | undefined;
      const uploadPromise = new Promise((resolve) => {
        resolveUpload = resolve;
      });

      mockUploadFile.mockImplementation(async (_file, onProgress) => {
        if (onProgress) {
          onProgress(35);
        }
        return uploadPromise;
      });

      mockSelect.mockReturnValueOnce(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      mockSelect.mockReturnValueOnce(
        createMockQueryChain([
          {
            ...TEST_FILE_WITHOUT_THUMBNAIL,
            id: 'uploaded-id',
            name: 'upload.txt',
            mimeType: 'text/plain'
          }
        ])
      );

      await renderFiles();

      const input = screen.getAllByTestId('dropzone-input')[0] as HTMLElement;
      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getAllByText('upload.txt').length).toBeGreaterThan(0);
        expect(screen.getByText(/35%/)).toBeInTheDocument();
      });

      if (resolveUpload) {
        resolveUpload({ id: 'uploaded-id', isDuplicate: false });
      }

      await waitFor(() => {
        expect(screen.getByTestId('upload-success-badge')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('upload-success-badge'));
      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });

    it('marks duplicate uploads without success badge', async () => {
      const user = userEvent.setup();
      const file = new File(['dup'], 'dup.txt', { type: 'text/plain' });

      mockUploadFile.mockResolvedValue({ id: 'dup-id', isDuplicate: true });
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );

      await renderFiles();

      const input = screen.getAllByTestId('dropzone-input')[0] as HTMLElement;
      await user.upload(input, file);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalled();
      });

      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });

    it('shows error status when upload fails', async () => {
      const user = userEvent.setup();
      const file = new File(['fail'], 'fail.txt', { type: 'text/plain' });
      mockUploadFile.mockRejectedValue(new Error('Upload failed'));
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );

      await renderFiles();

      const input = screen.getAllByTestId('dropzone-input')[0] as HTMLElement;
      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/Upload failed/)).toBeInTheDocument();
      });
    });
  });
});
