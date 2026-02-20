/**
 * Files page upload tests (progress, badges, dropzone, flow).
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockQueryChain,
  createMockUpdateChain,
  mockGetCurrentKey,
  mockIsFileStorageInitialized,
  mockRetrieve,
  mockRetrieveFileData,
  mockSelect,
  mockUpdate,
  mockUploadFile,
  mockUseDatabaseContext,
  renderFiles,
  renderFilesRaw,
  resetObjectUrlCounter,
  TEST_ENCRYPTION_KEY,
  TEST_FILE_WITH_THUMBNAIL,
  TEST_FILE_WITHOUT_THUMBNAIL,
  TEST_THUMBNAIL_DATA
} from './Files.testUtils';

describe('Files upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObjectUrlCounter();

    // Mock URL methods
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Default mocks for unlocked database
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_THUMBNAIL_DATA);
    mockRetrieveFileData.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mockUploadFile.mockReset();
    mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
    mockSelect.mockReturnValue(
      createMockQueryChain([
        TEST_FILE_WITH_THUMBNAIL,
        TEST_FILE_WITHOUT_THUMBNAIL
      ])
    );
    mockUpdate.mockReturnValue(createMockUpdateChain());
  });

  describe('upload success badge', () => {
    it('does not show success badge initially', async () => {
      // Success badge should not be present initially for existing files
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Initially, no success badge should be present
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

      // Verify dropzone has the expected structure
      expect(screen.getByText(/Drag and drop files here/i)).toBeInTheDocument();
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
      // Success badge only appears for newly uploaded files tracked in recentlyUploadedIds
      // Existing files in the database don't have this badge
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Existing files don't have the success badge
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

      // Dropzone should not be present when locked
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
