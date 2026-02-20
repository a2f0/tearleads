/**
 * Files page context menu tests.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockQueryChain,
  createMockUpdateChain,
  mockCurrentTrack,
  mockDownloadFile,
  mockGetCurrentKey,
  mockIsFileStorageInitialized,
  mockIsPlaying,
  mockNavigate,
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
  TEST_DELETED_FILE,
  TEST_ENCRYPTION_KEY,
  TEST_FILE_WITH_THUMBNAIL,
  TEST_FILE_WITHOUT_THUMBNAIL,
  TEST_THUMBNAIL_DATA,
  TEST_VIDEO_FILE
} from './Files.testUtils';

describe('Files context menu', () => {
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

  it('opens context menu on right-click for non-deleted files', async () => {
    mockSelect.mockReturnValue(
      createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
    );

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });

    // Right-click on the file row
    const fileRow = screen.getByText('photo.jpg').closest('div[class*="flex"]');
    expect(fileRow).toBeInTheDocument();
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    // Context menu should appear
    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
    });
  });

  it('shows Play action for audio files', async () => {
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Right-click on the audio file row
    const fileRow = screen.getByText('song.mp3').closest('div[class*="flex"]');
    expect(fileRow).toBeInTheDocument();
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    // Context menu should show Play action for audio
    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
      expect(screen.getByText('Get info')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
    });
  });

  it('shows Pause action when audio is playing', async () => {
    mockCurrentTrack.current = { id: 'audio-1' };
    mockIsPlaying.current = true;
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    // Right-click on the playing audio file row
    const fileRow = screen.getByText('song.mp3').closest('div[class*="flex"]');
    expect(fileRow).toBeInTheDocument();
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    // Context menu should show Pause action for currently playing audio
    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });
  });

  it('shows Play action for video files', async () => {
    mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    });

    // Right-click on the video file row
    const fileRow = screen.getByText('clip.mp4').closest('div[class*="flex"]');
    expect(fileRow).toBeInTheDocument();
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    // Context menu should show Play action for video
    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
      expect(screen.getByText('Get info')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
    });
  });

  it('navigates to video detail when Play is clicked for video file', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO_FILE]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    });

    // Right-click on the video file row
    const fileRow = screen.getByText('clip.mp4').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    // Click Play
    await user.click(screen.getByText('Play'));

    expect(mockNavigate).toHaveBeenCalledWith('/videos/file-4', {
      state: { from: '/', fromLabel: 'Back to Files' }
    });
  });

  it('does not show Get Info for non-viewable file types', async () => {
    const textFile = {
      id: 'text-1',
      name: 'notes.txt',
      size: 100,
      mimeType: 'text/plain',
      uploadDate: new Date('2024-01-16'),
      storagePath: '/files/notes.txt',
      thumbnailPath: null,
      deleted: false
    };
    mockSelect.mockReturnValue(createMockQueryChain([textFile]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
    });

    // Right-click on the text file row
    const fileRow = screen.getByText('notes.txt').closest('div[class*="flex"]');
    expect(fileRow).toBeInTheDocument();
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    // Context menu should NOT show Get info for non-viewable types
    await waitFor(() => {
      expect(screen.getByText('Download')).toBeInTheDocument();
    });
    expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    expect(screen.queryByText('Play')).not.toBeInTheDocument();
  });

  it('closes context menu when Escape is pressed', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(
      createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
    );

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen.getByText('photo.jpg').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    // Press Escape to close
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    });
  });

  it('closes context menu when backdrop is clicked', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(
      createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
    );

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen.getByText('photo.jpg').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    // Click backdrop to close
    await user.click(
      screen.getByRole('button', { name: /close context menu/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    });
  });

  it('does not open context menu for deleted files', async () => {
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

    // Right-click on the deleted file row
    const fileRow = screen
      .getByText('deleted.jpg')
      .closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    // Context menu should NOT appear for deleted files
    expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    // Note: Download text might still exist from inline button title
  });

  it('navigates to detail page when Get Info is clicked', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(
      createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
    );

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen.getByText('photo.jpg').closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    // Click Get Info
    await user.click(screen.getByText('Get info'));

    expect(mockNavigate).toHaveBeenCalledWith('/photos/file-1', {
      state: { from: '/', fromLabel: 'Back to Files' }
    });

    // Context menu should close
    await waitFor(() => {
      expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    });
  });

  it('downloads file when Download is clicked in context menu', async () => {
    const user = userEvent.setup();
    mockSelect.mockReturnValue(
      createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
    );
    mockRetrieveFileData.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

    await renderFiles();

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    // Right-click to open context menu
    const fileRow = screen
      .getByText('document.pdf')
      .closest('div[class*="flex"]');
    if (fileRow) {
      fireEvent.contextMenu(fileRow, { clientX: 100, clientY: 100 });
    }

    await waitFor(() => {
      expect(screen.getByText('Download')).toBeInTheDocument();
    });

    // Click Download in context menu
    await user.click(screen.getByText('Download'));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalled();
    });
  });

  it('deletes file when Delete is clicked in context menu', async () => {
    const user = userEvent.setup();
    mockCurrentTrack.current = null;
    mockIsPlaying.current = false;
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
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    // Click Delete
    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
    });
  });
});
