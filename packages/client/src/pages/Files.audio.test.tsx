/**
 * Files page audio file display tests.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockQueryChain,
  createMockUpdateChain,
  mockGetCurrentKey,
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
  TEST_AUDIO_FILE,
  TEST_DELETED_AUDIO_FILE,
  TEST_ENCRYPTION_KEY,
  TEST_FILE_WITH_THUMBNAIL,
  TEST_FILE_WITHOUT_THUMBNAIL,
  TEST_THUMBNAIL_DATA
} from './Files.testUtils';

describe('Files audio display', () => {
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

  it('renders music icon for audio files', async () => {
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Should show music icon (not FileIcon)
    const musicIcon = document.querySelector('.lucide-music');
    expect(musicIcon).toBeInTheDocument();
  });

  it('navigates to audio detail when audio file is clicked', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Click on the audio file name to navigate to detail view
    await user.click(screen.getByText('song.mp3'));

    expect(mockNavigate).toHaveBeenCalledWith('/audio/audio-1', {
      state: { from: '/', fromLabel: 'Back to Files' }
    });
  });

  it('does not navigate when clicking on deleted audio file', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_AUDIO_FILE]));

    await renderFiles();

    // Enable show deleted toggle
    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(screen.getByText('deleted-song.mp3')).toBeInTheDocument();
    });

    // Click on the deleted audio file - should NOT navigate because it's deleted
    await user.click(screen.getByText('deleted-song.mp3'));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
