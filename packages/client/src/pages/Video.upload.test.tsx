import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPage } from './Video';
import {
  createMockQueryChain,
  setupVideoPageMocks,
  TEST_VIDEO
} from './Video.testSetup';

// Create hoisted mocks inline - cannot call imported functions in vi.hoisted()
const mocks = vi.hoisted(() => ({
  mockUseDatabaseContext: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsertValues: vi.fn(),
  mockInsert: vi.fn(),
  mockNavigate: vi.fn(),
  mockGetCurrentKey: vi.fn(),
  mockRetrieve: vi.fn(),
  mockStore: vi.fn(),
  mockIsFileStorageInitialized: vi.fn(),
  mockInitializeFileStorage: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDetectPlatform: vi.fn()
}));

// Mock VideoPlaylistsSidebar
vi.mock('@/components/video-window/VideoPlaylistsSidebar', () => ({
  ALL_VIDEO_ID: '__all__',
  VideoPlaylistsSidebar: vi.fn(
    ({
      selectedPlaylistId,
      onPlaylistSelect,
      onPlaylistChanged,
      onDropToPlaylist,
      onWidthChange,
      width
    }) => (
      <div data-testid="video-playlists-sidebar">
        <span data-testid="selected-playlist">{selectedPlaylistId}</span>
        <span data-testid="sidebar-width">{width}</span>
        <button
          type="button"
          data-testid="select-playlist-1"
          onClick={() => onPlaylistSelect('playlist-1')}
        >
          Select Playlist 1
        </button>
        <button
          type="button"
          data-testid="trigger-playlist-changed"
          onClick={() => onPlaylistChanged?.()}
        >
          Trigger Playlist Changed
        </button>
        <button
          type="button"
          data-testid="change-width"
          onClick={() => onWidthChange?.(300)}
        >
          Change Width
        </button>
        <button
          type="button"
          data-testid="drop-to-playlist"
          onClick={() =>
            onDropToPlaylist?.('playlist-1', [], ['video-1', 'video-2'])
          }
        >
          Drop To Playlist
        </button>
      </div>
    )
  )
}));

// Mock ClientVideoProvider
vi.mock('@/contexts/ClientVideoProvider', () => ({
  ClientVideoProvider: vi.fn(({ children }) => (
    <div data-testid="client-video-provider">{children}</div>
  ))
}));

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn()
  }))
}));

// Mock the database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mocks.mockUseDatabaseContext()
}));

// Mock the database
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mocks.mockSelect,
    update: mocks.mockUpdate,
    insert: mocks.mockInsert
  })
}));

// Mock navigation
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.mockNavigate,
    useLocation: () => ({ pathname: '/', state: null })
  };
});

// Mock the key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mocks.mockGetCurrentKey
  })
}));

// Mock file storage
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mocks.mockRetrieve,
    measureRetrieve: mocks.mockRetrieve,
    store: mocks.mockStore
  }),
  isFileStorageInitialized: () => mocks.mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) =>
    mocks.mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
}));

// Mock useFileUpload hook
vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mocks.mockUploadFile
  })
}));

// Mock detectPlatform to return 'web' by default (supports drag and drop)
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    detectPlatform: () => mocks.mockDetectPlatform()
  };
});

function renderVideoRaw(props?: {
  onOpenVideo?: (
    videoId: string,
    options?: { autoPlay?: boolean | undefined }
  ) => void;
  hideBackLink?: boolean;
  viewMode?: 'list' | 'table';
}) {
  return render(
    <MemoryRouter>
      <VideoPage {...props} />
    </MemoryRouter>
  );
}

async function renderVideo(props?: {
  onOpenVideo?: (
    videoId: string,
    options?: { autoPlay?: boolean | undefined }
  ) => void;
  hideBackLink?: boolean;
  viewMode?: 'list' | 'table';
  onUpload?: () => void;
}) {
  const result = renderVideoRaw(props);
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading videos...')).not.toBeInTheDocument();
  });
  return result;
}

describe('VideoPage - File Upload', () => {
  let user: ReturnType<typeof userEvent.setup>;
  const videoFile = new File(['video content'], 'test.mp4', {
    type: 'video/mp4'
  });
  let input: HTMLElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    setupVideoPageMocks(mocks);
    mocks.mockSelect.mockReturnValue(createMockQueryChain([]));
    mocks.mockDetectPlatform.mockReturnValue('web');
    user = userEvent.setup();
    await renderVideo();

    expect(screen.getByTestId('dropzone')).toBeInTheDocument();

    input = screen.getByTestId('dropzone-input');
  });

  it('uploads valid video file when dropped', async () => {
    await user.upload(input as HTMLInputElement, videoFile);

    await waitFor(() => {
      expect(mocks.mockUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test.mp4' }),
        expect.any(Function)
      );
    });
  });

  it('refreshes videos after successful upload', async () => {
    mocks.mockSelect.mockClear();
    mocks.mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));

    await user.upload(input as HTMLInputElement, videoFile);

    // Flush the setTimeout used for instance-aware fetching after upload triggers hasFetched = false
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mocks.mockSelect).toHaveBeenCalled();
    });
  });

  it('handles upload error gracefully', async () => {
    mocks.mockUploadFile.mockRejectedValue(new Error('Upload failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await user.upload(input as HTMLInputElement, videoFile);

    await waitFor(() => {
      expect(screen.getByText('Upload failed')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('shows upload progress while uploading', async () => {
    let progressCallback: (progress: number) => void = () => {};
    const uploadControl = { resolve: () => {} };

    mocks.mockUploadFile.mockImplementation((_file, onProgress) => {
      progressCallback = onProgress ?? (() => {});
      return new Promise<void>((resolve) => {
        uploadControl.resolve = resolve;
      });
    });

    await user.upload(input as HTMLInputElement, videoFile);

    act(() => {
      progressCallback(55);
    });

    const progressbar = screen.getByRole('progressbar', {
      name: /upload progress/i
    });
    expect(progressbar).toHaveAttribute('aria-valuenow', '55');
    expect(screen.getByText('55%')).toBeInTheDocument();

    uploadControl.resolve();

    await waitFor(() => {
      expect(
        screen.queryByRole('progressbar', { name: /upload progress/i })
      ).not.toBeInTheDocument();
    });
  });

  it('shows error for unsupported video format', async () => {
    // Use video/x-ms-wmv which is not in VIDEO_MIME_TYPES list
    const unsupportedFile = new File(['content'], 'test.wmv', {
      type: 'video/x-ms-wmv'
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await user.upload(input as HTMLInputElement, unsupportedFile);

    await waitFor(() => {
      expect(
        screen.getByText(/has an unsupported video format/i)
      ).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});
