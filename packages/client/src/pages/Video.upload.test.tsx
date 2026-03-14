import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as utils from '@/lib/utils';
import { VideoPage } from './Video';
import {
  createMockQueryChain,
  setupVideoPageMocks,
  TEST_VIDEO
} from './Video.testSetup';

function createMocks() {
  return {
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
  };
}

var mocksState: ReturnType<typeof createMocks> | undefined;

function getMocks() {
  if (!mocksState) {
    mocksState = createMocks();
  }
  if (!mocksState) {
    throw new Error('Expected mocksState to be initialized');
  }
  return mocksState;
}

const mocks = getMocks();

vi.spyOn(utils, 'detectPlatform').mockImplementation(() =>
  getMocks().mockDetectPlatform()
);

// Mock VideoPlaylistsSidebar
vi.mock('@/components/window-video/VideoPlaylistsSidebar', () => ({
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
  useDatabaseContext: () => getMocks().mockUseDatabaseContext()
}));

// Mock the database
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: getMocks().mockSelect,
    update: getMocks().mockUpdate,
    insert: getMocks().mockInsert
  })
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  return {
    ...actual,
    useNavigate: () => getMocks().mockNavigate,
    useLocation: () => ({ pathname: '/', state: null })
  };
});

// Mock the key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: getMocks().mockGetCurrentKey
  })
}));

// Mock file storage
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: getMocks().mockRetrieve,
    measureRetrieve: getMocks().mockRetrieve,
    store: getMocks().mockStore
  }),
  isFileStorageInitialized: () => getMocks().mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) =>
    getMocks().mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
}));

// Mock useFileUpload hook
vi.mock('@/hooks/vfs/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: getMocks().mockUploadFile
  })
}));

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
