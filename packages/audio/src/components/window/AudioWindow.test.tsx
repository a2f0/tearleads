import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioProvider } from '../../context/AudioContext';
import { createWrapper } from '../../test/testUtils';
import { AudioWindow } from './AudioWindow';

vi.mock('@tearleads/window-manager', () => ({
  FloatingWindow: ({ children }: { children: ReactNode }) => (
    <div data-testid="floating-window">{children}</div>
  ),
  WindowControlBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="control-bar">{children}</div>
  ),
  WindowControlGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  WindowControlButton: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: vi.fn()
  })
}));

vi.mock('./AudioPlaylistsSidebar', () => ({
  ALL_AUDIO_ID: '__all__',
  AudioPlaylistsSidebar: ({
    selectedPlaylistId,
    onPlaylistSelect
  }: {
    selectedPlaylistId: string | null;
    onPlaylistSelect: (id: string | null) => void;
  }) => (
    <div data-testid="audio-playlists-sidebar">
      <button
        type="button"
        data-testid="select-playlist"
        onClick={() => onPlaylistSelect('test-playlist-id')}
      >
        Select Playlist
      </button>
      <span data-testid="selected-playlist">{selectedPlaylistId}</span>
    </div>
  )
}));

describe('AudioWindow', () => {
  function renderWithProviders(
    options: Parameters<typeof createWrapper>[0] = {}
  ) {
    const Wrapper = createWrapper(options);
    return render(
      <Wrapper>
        <AudioProvider>
          <AudioWindow
            id="test-audio-window"
            onClose={vi.fn()}
            onMinimize={vi.fn()}
            onFocus={vi.fn()}
            zIndex={100}
          />
        </AudioProvider>
      </Wrapper>
    );
  }

  it('renders the floating window', () => {
    renderWithProviders();
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: false, isLoading: false }
    });
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('shows loading state when database is loading', () => {
    renderWithProviders({
      databaseState: {
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      }
    });
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders the File dropdown menu', () => {
    renderWithProviders();
    expect(screen.getByTestId('dropdown-file')).toBeInTheDocument();
  });

  it('renders the View dropdown menu', () => {
    renderWithProviders();
    expect(screen.getByTestId('dropdown-view')).toBeInTheDocument();
  });

  it('renders the Help dropdown menu', () => {
    renderWithProviders();
    expect(screen.getByTestId('dropdown-help')).toBeInTheDocument();
  });

  it('renders control bar actions in list view', () => {
    renderWithProviders();
    expect(screen.getByTestId('control-bar')).toBeInTheDocument();
    expect(screen.getByTestId('audio-window-control-upload')).toBeInTheDocument();
    expect(
      screen.getByTestId('audio-window-control-refresh')
    ).toBeInTheDocument();
  });

  it('renders without error when database is unlocked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: true }
    });

    // Should render the floating window when database is unlocked
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows sidebar when database is unlocked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: true }
    });
    expect(screen.getByTestId('audio-playlists-sidebar')).toBeInTheDocument();
  });

  it('hides sidebar when database is locked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: false, isLoading: false }
    });
    expect(
      screen.queryByTestId('audio-playlists-sidebar')
    ).not.toBeInTheDocument();
  });

  it('triggers file input from the control bar upload action', async () => {
    const user = userEvent.setup();
    renderWithProviders();

    const fileInput = screen.getByTestId('audio-file-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('audio-window-control-upload'));

    expect(clickSpy).toHaveBeenCalled();
  });

  describe('upload to playlist', () => {
    const mockUploadFile = vi.fn();
    const mockAddTrackToPlaylist = vi.fn();

    beforeEach(() => {
      mockUploadFile.mockClear();
      mockUploadFile.mockResolvedValue('uploaded-file-id');
      mockAddTrackToPlaylist.mockClear();
      mockAddTrackToPlaylist.mockResolvedValue(undefined);
    });

    function renderWithUploadMocks(
      options: Parameters<typeof createWrapper>[0] = {}
    ) {
      const Wrapper = createWrapper({
        databaseState: { isUnlocked: true },
        uploadFile: mockUploadFile,
        addTrackToPlaylist: mockAddTrackToPlaylist,
        ...options
      });
      return render(
        <Wrapper>
          <AudioProvider>
            <AudioWindow
              id="test-audio-window"
              onClose={vi.fn()}
              onMinimize={vi.fn()}
              onFocus={vi.fn()}
              zIndex={100}
            />
          </AudioProvider>
        </Wrapper>
      );
    }

    it('adds uploaded files to selected playlist', async () => {
      const user = userEvent.setup();
      renderWithUploadMocks();

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
        'audio-file-input'
      ) as HTMLInputElement;
      const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });

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

    it('does not add to playlist when "All Audio" is selected', async () => {
      const user = userEvent.setup();
      renderWithUploadMocks();

      // By default, "All Audio" is selected (ALL_AUDIO_ID)
      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        '__all__'
      );

      // Upload a file
      const fileInput = screen.getByTestId(
        'audio-file-input'
      ) as HTMLInputElement;
      const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });

      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
      });

      // Should NOT call addTrackToPlaylist when "All Audio" is selected
      expect(mockAddTrackToPlaylist).not.toHaveBeenCalled();
    });
  });
});
