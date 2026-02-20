/**
 * Files page context menu audio playback tests.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import {
  createMockQueryChain,
  createMockUpdateChain,
  mockCurrentTrack,
  mockGetCurrentKey,
  mockIsFileStorageInitialized,
  mockIsPlaying,
  mockPause,
  mockPlay,
  mockResume,
  mockRetrieve,
  mockRetrieveFileData,
  mockSelect,
  mockUpdate,
  mockUploadFile,
  mockUseDatabaseContext,
  renderFiles,
  resetObjectUrlCounter,
  TEST_AUDIO_FILE,
  TEST_ENCRYPTION_KEY,
  TEST_FILE_WITH_THUMBNAIL,
  TEST_FILE_WITHOUT_THUMBNAIL,
  TEST_THUMBNAIL_DATA
} from './Files.testUtils';

describe('Files context menu audio playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObjectUrlCounter();

    // Mock URL methods
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Reset audio mocks
    mockCurrentTrack.current = null;
    mockIsPlaying.current = false;
    mockPlay.mockClear();
    mockPause.mockClear();
    mockResume.mockClear();

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

  it('plays audio when Play is clicked in context menu', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));
    mockRetrieveFileData.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen.getByText('song.mp3').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    // Click Play
    await user.click(screen.getByText('Play'));

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });
  });

  it('pauses audio when Pause is clicked in context menu', async () => {
    const user = userEvent.setup();
    mockCurrentTrack.current = { id: 'audio-1' };
    mockIsPlaying.current = true;
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen.getByText('song.mp3').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    // Click Pause
    await user.click(screen.getByText('Pause'));

    await waitFor(() => {
      expect(mockPause).toHaveBeenCalled();
    });
  });

  it('resumes audio when Play is clicked for paused track', async () => {
    const user = userEvent.setup();
    mockCurrentTrack.current = { id: 'audio-1' };
    mockIsPlaying.current = false; // Paused
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen.getByText('song.mp3').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    // Click Play (should resume)
    await user.click(screen.getByText('Play'));

    await waitFor(() => {
      expect(mockResume).toHaveBeenCalled();
    });
  });

  it('revokes previous URL when playing a different track', async () => {
    const user = userEvent.setup();
    const SECOND_AUDIO_FILE = {
      id: 'audio-2',
      name: 'song2.mp3',
      size: 3072,
      mimeType: 'audio/mpeg',
      uploadDate: new Date('2024-01-13'),
      storagePath: '/files/song2.mp3',
      thumbnailPath: null,
      deleted: false
    };
    mockCurrentTrack.current = null;
    mockIsPlaying.current = false;
    mockSelect.mockReturnValue(
      createMockQueryChain([TEST_AUDIO_FILE, SECOND_AUDIO_FILE])
    );

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
      expect(screen.getByText('song2.mp3')).toBeInTheDocument();
    });

    // Play first track
    const firstRow = screen.getByText('song.mp3').closest('div[class*="flex"]');
    if (firstRow) {
      fireEvent.contextMenu(firstRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Play'));

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });

    // Reset and play second track - this should revoke the first URL
    mockPlay.mockClear();
    const revokeCallsBefore = vi.mocked(URL.revokeObjectURL).mock.calls.length;

    const secondRow = screen
      .getByText('song2.mp3')
      .closest('div[class*="flex"]');
    if (secondRow) {
      fireEvent.contextMenu(secondRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Play'));

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
      // URL.revokeObjectURL should have been called more times than before
      expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeGreaterThan(
        revokeCallsBefore
      );
    });
  });

  it('handles errors when loading audio fails', async () => {
    const user = userEvent.setup();
    mockCurrentTrack.current = null;
    mockIsPlaying.current = false;
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));
    mockRetrieveFileData.mockRejectedValueOnce(new Error('Failed to load'));
    mockConsoleError();

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen.getByText('song.mp3').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    // Click Play - should fail
    await user.click(screen.getByText('Play'));

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });
});
