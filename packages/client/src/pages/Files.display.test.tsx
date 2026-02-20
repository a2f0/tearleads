/**
 * Files page display tests (file list, thumbnails, empty state, deleted toggle).
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleWarn } from '@/test/consoleMocks';
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
  resetObjectUrlCounter,
  TEST_DELETED_FILE,
  TEST_ENCRYPTION_KEY,
  TEST_FILE_WITH_THUMBNAIL,
  TEST_FILE_WITHOUT_THUMBNAIL,
  TEST_THUMBNAIL_DATA
} from './Files.testUtils';

describe('Files display', () => {
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

  describe('when files are loaded', () => {
    it('renders file list with names', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });
    });

    it('renders file sizes', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText(/1 KB/)).toBeInTheDocument();
        expect(screen.getByText(/2 KB/)).toBeInTheDocument();
      });
    });

    it('shows file count', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText(/2 files$/)).toBeInTheDocument();
      });
    });

    it('renders page title', async () => {
      await renderFiles();
      expect(screen.getByText('Files')).toBeInTheDocument();
    });

    it('renders Refresh button', async () => {
      await renderFiles();
      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });
  });

  describe('thumbnail display', () => {
    it('attempts to load thumbnail for files with thumbnailPath', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Verify storage retrieve was called for the thumbnail
      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/files/photo-thumb.jpg',
          expect.any(Function)
        );
      });
    });

    it('does not load thumbnail for files without thumbnailPath', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      // Should not call retrieve since there's no thumbnail
      expect(mockRetrieve).not.toHaveBeenCalled();
    });

    it('handles thumbnail load failure gracefully', async () => {
      const consoleSpy = mockConsoleWarn();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      mockRetrieve.mockRejectedValue(new Error('Storage error'));
      await renderFiles();

      // File should still render even if thumbnail fails
      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Should not have any img elements since thumbnail failed to load
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load thumbnail for photo.jpg:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('revokes object URLs on unmount to prevent memory leaks', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      const { unmount } = await renderFiles();

      // Wait for thumbnail to load
      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(URL.createObjectURL).toHaveBeenCalled();
      });

      // Unmount the component
      unmount();

      // Verify revokeObjectURL was called for cleanup
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows empty state message when no files', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(
          screen.getByText(
            'No files found. Drop or select files above to upload.'
          )
        ).toBeInTheDocument();
      });
    });
  });

  describe('show deleted toggle', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(
        createMockQueryChain([
          TEST_FILE_WITH_THUMBNAIL,
          TEST_FILE_WITHOUT_THUMBNAIL,
          TEST_DELETED_FILE
        ])
      );
    });

    it('hides deleted files by default', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      expect(screen.queryByText('deleted.jpg')).not.toBeInTheDocument();
    });

    it('shows deleted files when toggle is enabled', async () => {
      const user = userEvent.setup();
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Click the toggle switch
      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      await waitFor(() => {
        expect(screen.getByText('deleted.jpg')).toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refetches files when Refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      mockSelect.mockClear();

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });
  });
});
