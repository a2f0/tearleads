import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoWindow } from './VideoWindow';

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowOpenRequest: () => undefined
}));

vi.mock('@/contexts/ClientVideoProvider', () => ({
  ClientVideoProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )
}));

const mockAddTrackToPlaylist = vi.fn();
const videoPageMount = vi.fn();

vi.mock('./VideoPlaylistsSidebar', () => ({
  ALL_VIDEO_ID: '__ALL_VIDEO__',
  VideoPlaylistsSidebar: ({
    selectedPlaylistId,
    onPlaylistSelect,
    onDropToPlaylist
  }: {
    selectedPlaylistId: string | null;
    onPlaylistSelect: (id: string | null) => void;
    onDropToPlaylist?: (
      playlistId: string,
      files: File[],
      videoIds?: string[]
    ) => void | Promise<void>;
  }) => (
    <div data-testid="video-playlists-sidebar">
      <button
        type="button"
        data-testid="select-playlist"
        onClick={() => onPlaylistSelect('test-playlist-id')}
      >
        Select Playlist
      </button>
      <span data-testid="selected-playlist">{selectedPlaylistId}</span>
      <button
        type="button"
        data-testid="drop-video-ids"
        onClick={() =>
          onDropToPlaylist?.('test-playlist-id', [], ['video-1', 'video-2'])
        }
      >
        Drop Video Ids
      </button>
    </div>
  )
}));

vi.mock('@/video/VideoPlaylistContext', () => ({
  useVideoPlaylistContext: () => ({
    addTrackToPlaylist: mockAddTrackToPlaylist
  })
}));

const mockUploadFile = vi.fn();

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: ({
      children,
      title,
      onClose,
      initialDimensions
    }: {
      children: React.ReactNode;
      title: string;
      onClose: () => void;
      initialDimensions?: {
        width: number;
        height: number;
        x: number;
        y: number;
      };
    }) => (
      <div
        data-testid="floating-window"
        data-initial-dimensions={
          initialDimensions ? JSON.stringify(initialDimensions) : undefined
        }
      >
        <div data-testid="window-title">{title}</div>
        <button type="button" onClick={onClose} data-testid="close-window">
          Close
        </button>
        {children}
      </div>
    )
  };
});

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({ uploadFile: mockUploadFile })
}));

vi.mock('@/pages/Video', () => ({
  VideoPage: ({
    onOpenVideo,
    hideBackLink,
    viewMode
  }: {
    onOpenVideo?: (
      videoId: string,
      options?: { autoPlay?: boolean | undefined }
    ) => void;
    hideBackLink?: boolean;
    viewMode?: 'list' | 'table';
  }) => {
    useEffect(() => {
      videoPageMount();
    }, []);

    return (
      <>
        <div data-testid="video-view-mode">{viewMode}</div>
        <button
          type="button"
          onClick={() => onOpenVideo?.('test-video')}
          data-testid="open-video"
        >
          Open Video
        </button>
        {hideBackLink && <div data-testid="back-link-hidden" />}
      </>
    );
  }
}));

vi.mock('@/pages/VideoDetail', () => ({
  VideoDetail: ({
    onBack,
    hideBackLink
  }: {
    onBack?: () => void;
    hideBackLink?: boolean;
  }) => (
    <div data-testid="video-detail">
      Video Detail
      {!hideBackLink && (
        <button type="button" onClick={onBack} data-testid="video-back">
          Back
        </button>
      )}
    </div>
  )
}));

describe('VideoWindow', () => {
  const defaultProps = {
    id: 'video-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    mockUploadFile.mockClear();
    mockUploadFile.mockResolvedValue({
      id: 'uploaded-file-id',
      isDuplicate: false
    });
    mockAddTrackToPlaylist.mockClear();
    mockAddTrackToPlaylist.mockResolvedValue(undefined);
    videoPageMount.mockClear();
  });

  it('renders in FloatingWindow', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Videos as title', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Videos');
  });

  it('renders the VideoPage content', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('video-view-mode')).toHaveTextContent('list');
    expect(screen.getByTestId('open-video')).toBeInTheDocument();
    expect(screen.getByTestId('back-link-hidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('renders control bar actions in list view', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(
      screen.getByTestId('video-window-control-upload')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('video-window-control-refresh')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('video-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('wraps list content in a scrollable container', () => {
    render(<VideoWindow {...defaultProps} />);
    const container = screen.getByTestId('video-view-mode').parentElement;
    expect(container).toHaveClass('overflow-auto');
    expect(container).toHaveClass('h-full');
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VideoWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders video detail when navigating to a video', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-video'));
    expect(screen.getByTestId('video-detail')).toBeInTheDocument();
    expect(screen.getByTestId('video-back')).toBeInTheDocument();
  });

  it('returns to the list when back is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-video'));
    expect(screen.getByTestId('video-detail')).toBeInTheDocument();

    await user.click(screen.getByTestId('video-back'));
    expect(screen.getByTestId('open-video')).toBeInTheDocument();
  });

  it('returns to the list when control bar back is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-video'));
    expect(screen.getByTestId('video-window-control-back')).toBeInTheDocument();

    await user.click(screen.getByTestId('video-window-control-back'));
    expect(screen.getByTestId('open-video')).toBeInTheDocument();
    expect(
      screen.queryByTestId('video-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('switches to the table view from the menu', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    expect(screen.getByTestId('video-view-mode')).toHaveTextContent('table');
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 640,
      height: 480,
      x: 120,
      y: 80
    };
    render(
      <VideoWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('uploads selected files from the file input', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    const fileInput = screen.getByTestId(
      'video-file-input'
    ) as HTMLInputElement;
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
    });
  });

  it('adds uploaded files to selected playlist', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    // Select a playlist first
    await user.click(screen.getByTestId('select-playlist'));

    // Verify playlist is selected
    await waitFor(() => {
      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        'test-playlist-id'
      );
    });

    // Upload a file
    const fileInput = screen.getByTestId(
      'video-file-input'
    ) as HTMLInputElement;
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
    });

    await waitFor(() => {
      expect(mockAddTrackToPlaylist).toHaveBeenCalledWith(
        'test-playlist-id',
        'uploaded-file-id'
      );
    });
  });

  it('does not add to playlist when "All Videos" is selected', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    // By default, "All Videos" is selected (ALL_VIDEO_ID)
    expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
      '__ALL_VIDEO__'
    );

    // Upload a file
    const fileInput = screen.getByTestId(
      'video-file-input'
    ) as HTMLInputElement;
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
    });

    // Should NOT call addTrackToPlaylist when "All Videos" is selected
    expect(mockAddTrackToPlaylist).not.toHaveBeenCalled();
  });

  it('adds dropped existing videos to target playlist', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByTestId('drop-video-ids'));

    await waitFor(() => {
      expect(mockAddTrackToPlaylist).toHaveBeenCalledWith(
        'test-playlist-id',
        'video-1'
      );
      expect(mockAddTrackToPlaylist).toHaveBeenCalledWith(
        'test-playlist-id',
        'video-2'
      );
    });
  });

  it('opens the file picker from the menu upload action', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');

    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Upload' }));

    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it('opens the file picker from the control bar upload action', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');

    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByTestId('video-window-control-upload'));

    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it('refreshes video page from the control bar refresh action', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    expect(videoPageMount).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('video-window-control-refresh'));

    expect(videoPageMount).toHaveBeenCalledTimes(2);
  });

  it('renders without error when inside a router context (WindowRenderer is inside BrowserRouter)', () => {
    expect(() =>
      render(
        <MemoryRouter>
          <VideoWindow {...defaultProps} />
        </MemoryRouter>
      )
    ).not.toThrow();
    expect(screen.getByTestId('video-view-mode')).toBeInTheDocument();
  });

  it('shows upload progress during file upload', async () => {
    const user = userEvent.setup();
    let resolveUpload: (value: { id: string; isDuplicate: boolean }) => void =
      () => {};
    mockUploadFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        })
    );

    render(<VideoWindow {...defaultProps} />);

    const fileInput = screen.getByTestId(
      'video-file-input'
    ) as HTMLInputElement;
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText('Uploading...')).toBeInTheDocument();
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // Resolve the upload to clean up
    resolveUpload({ id: 'uploaded-file-id', isDuplicate: false });
    await waitFor(() => {
      expect(screen.queryByText('Uploading...')).not.toBeInTheDocument();
    });
  });
});
