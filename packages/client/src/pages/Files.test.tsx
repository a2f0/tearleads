/**
 * Files page edge cases and miscellaneous tests.
 */

import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import {
  createMockQueryChain,
  createMockUpdateChain,
  instanceChangeCallback,
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

describe('Files', () => {
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

  describe('error handling', () => {
    it('displays error message when fetching fails', async () => {
      const consoleSpy = mockConsoleError();
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockRejectedValue(new Error('Database error'))
        })
      });

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch files:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('error handling edge cases', () => {
    it('displays error when encryption key is not available', async () => {
      const consoleSpy = mockConsoleError();
      mockGetCurrentKey.mockReturnValue(null);

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('Database not unlocked')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch files:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('displays error when no active instance', async () => {
      const consoleSpy = mockConsoleError();
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: null
      });
      mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('No active instance')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch files:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('virtual list edges', () => {
    it('skips rendering when virtualizer returns an out-of-range item', async () => {
      const { useVirtualizer } = await import('@tanstack/react-virtual');
      // @ts-expect-error mock return is intentionally partial for this edge case
      vi.mocked(useVirtualizer).mockImplementationOnce(({ count }) => ({
        getVirtualItems: Object.assign(
          () => [
            { index: 0, start: 0, size: 56, end: 56, key: 0, lane: 0 },
            {
              index: count,
              start: 56,
              size: 56,
              end: 112,
              key: count,
              lane: 0
            }
          ],
          { updateDeps: vi.fn() }
        ),
        getTotalSize: () => count * 56,
        measureElement: vi.fn()
      }));

      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });
    });
  });

  describe('instance switching', () => {
    it('cleans up thumbnails when switching instances', async () => {
      const context = {
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'instance-a'
      };
      mockUseDatabaseContext.mockImplementation(() => context);
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );

      renderFilesRaw();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Trigger instance change via the captured callback
      act(() => {
        if (instanceChangeCallback) {
          instanceChangeCallback();
        }
      });

      await waitFor(() => {
        expect(URL.revokeObjectURL).toHaveBeenCalled();
      });
    });
  });
});
