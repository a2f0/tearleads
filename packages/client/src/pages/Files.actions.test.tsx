/**
 * Files page action tests (navigation, download, delete, restore).
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import {
  createMockQueryChain,
  createMockUpdateChain,
  mockDownloadFile,
  mockGetCurrentKey,
  mockInitializeFileStorage,
  mockIsFileStorageInitialized,
  mockNavigate,
  mockRetrieve,
  mockRetrieveFileData,
  mockSelect,
  mockUpdate,
  mockUploadFile,
  mockUseDatabaseContext,
  renderFiles,
  resetObjectUrlCounter,
  TEST_DELETED_FILE,
  TEST_ENCRYPTION_KEY,
  TEST_FILE_WITH_THUMBNAIL,
  TEST_FILE_WITHOUT_THUMBNAIL,
  TEST_THUMBNAIL_DATA,
  TEST_VIDEO_FILE
} from './Files.testUtils';

describe('Files actions', () => {
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

  describe('file navigation', () => {
    it('navigates to photo detail when image card is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Click on the file name to navigate to detail view
      await user.click(screen.getByText('photo.jpg'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/file-1', {
        state: { from: '/', fromLabel: 'Back to Files' }
      });
    });

    it('navigates to documents when PDF file card is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      // Click on the file name - should navigate to documents for PDFs
      await user.click(screen.getByText('document.pdf'));

      expect(mockNavigate).toHaveBeenCalledWith('/documents/file-2', {
        state: { from: '/', fromLabel: 'Back to Files' }
      });
    });

    it('navigates to video detail when video file card is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO_FILE]));
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('clip.mp4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('clip.mp4'));

      expect(mockNavigate).toHaveBeenCalledWith('/videos/file-4', {
        state: { from: '/', fromLabel: 'Back to Files' }
      });
    });

    it('does not navigate for non-viewable file types', async () => {
      const user = userEvent.setup();
      const testFile = {
        ...TEST_FILE_WITHOUT_THUMBNAIL,
        id: 'file-unknown',
        name: 'notes.txt',
        mimeType: 'text/plain'
      };
      mockSelect.mockReturnValue(createMockQueryChain([testFile]));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('notes.txt')).toBeInTheDocument();
      });

      await user.click(screen.getByText('notes.txt'));

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('does not navigate when clicking on deleted image file', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));

      await renderFiles();

      // Enable show deleted toggle
      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByText('deleted.jpg')).toBeInTheDocument();
      });

      // Click on the deleted file - should NOT navigate because it's deleted
      await user.click(screen.getByText('deleted.jpg'));

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('action buttons', () => {
    it('renders Download button for non-deleted files', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getAllByTitle('Download').length).toBeGreaterThan(0);
      });
    });

    it('renders Delete button for non-deleted files', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getAllByTitle('Delete').length).toBeGreaterThan(0);
      });
    });

    it('renders Restore button for deleted files', async () => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));
      await renderFiles();

      // Enable show deleted toggle first
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByTitle('Restore')).toBeInTheDocument();
      });
    });
  });

  describe('file storage initialization', () => {
    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);
      await renderFiles();

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalledWith(
          TEST_ENCRYPTION_KEY,
          'test-instance'
        );
      });
    });
  });

  describe('download functionality', () => {
    it('downloads file when Download button is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      mockRetrieveFileData.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Download'));

      await waitFor(() => {
        expect(mockRetrieveFileData).toHaveBeenCalledWith(
          '/files/document.pdf',
          'test-instance'
        );
        expect(mockDownloadFile).toHaveBeenCalled();
      });
    });

    it('initializes file storage if not initialized before download', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      mockIsFileStorageInitialized.mockReturnValue(false);
      mockRetrieveFileData.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Download'));

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalled();
      });
    });

    it('displays error when download fails', async () => {
      const user = userEvent.setup();
      const consoleSpy = mockConsoleError();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      mockRetrieveFileData.mockRejectedValueOnce(new Error('Download failed'));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Download'));

      await waitFor(() => {
        expect(screen.getByText('Download failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to download file:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('delete functionality', () => {
    it('soft deletes file when Delete button is clicked', async () => {
      const user = userEvent.setup();
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Click delete on the first file
      const deleteButtons = screen.getAllByTitle('Delete');
      expect(deleteButtons.length).toBeGreaterThan(0);
      const firstDeleteButton = deleteButtons[0];
      if (firstDeleteButton) {
        await user.click(firstDeleteButton);
      }

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('displays error when delete fails', async () => {
      const user = userEvent.setup();
      const consoleSpy = mockConsoleError();
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Delete failed'))
        })
      });

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete');
      expect(deleteButtons.length).toBeGreaterThan(0);
      const firstDeleteButton = deleteButtons[0];
      if (firstDeleteButton) {
        await user.click(firstDeleteButton);
      }

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete file:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('restore functionality', () => {
    it('restores deleted file when Restore button is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));

      await renderFiles();

      // Enable show deleted toggle
      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByText('deleted.jpg')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Restore'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('displays error when restore fails', async () => {
      const user = userEvent.setup();
      const consoleSpy = mockConsoleError();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Restore failed'))
        })
      });

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByTitle('Restore')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Restore'));

      await waitFor(() => {
        expect(screen.getByText('Restore failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to restore file:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
