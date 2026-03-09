import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioProvider } from '../../context/AudioContext';
import { createMockAudioTrack, createWrapper } from '../../test/testUtils';
import { AudioWindowList } from './AudioWindowList';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (config: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: config.count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => config.count * 56,
    measureElement: vi.fn()
  })
}));

const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();

describe('AudioWindowList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  function renderWithAudioProvider(
    ui: React.ReactElement,
    options: Parameters<typeof createWrapper>[0] = {}
  ) {
    const Wrapper = createWrapper(options);
    return render(
      <Wrapper>
        <AudioProvider>{ui}</AudioProvider>
      </Wrapper>
    );
  }

  it('shows database loading state', () => {
    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: {
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      }
    });

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: {
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null
      }
    });

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders header with Audio title', () => {
    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true }
    });

    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true }
    });

    expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
  });

  it('does not render refresh button when database is locked', () => {
    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: false }
    });

    expect(screen.queryByTestId('refresh-button')).not.toBeInTheDocument();
  });

  it('shows empty state when no tracks exist', async () => {
    const fetchAudioFilesWithUrls = vi.fn(async () => []);

    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    await waitFor(() => {
      expect(screen.getByText('No audio files')).toBeInTheDocument();
    });

    expect(screen.getByText('Use Upload to add audio')).toBeInTheDocument();
  });

  it('renders tracks when data is loaded', async () => {
    const mockTrack = createMockAudioTrack({
      id: 'track-1',
      name: 'Test Song.mp3',
      size: 1024000
    });
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);

    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    await waitFor(() => {
      expect(screen.getByText('Test Song.mp3')).toBeInTheDocument();
    });
  });

  it('filters tracks by selected playlist', async () => {
    const mockTrack = createMockAudioTrack({
      id: 'track-1',
      name: 'Playlist Song.mp3'
    });
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);
    const getTrackIdsInPlaylist = vi.fn(async () => ['track-1']);

    renderWithAudioProvider(
      <AudioWindowList selectedPlaylistId="playlist-1" />,
      {
        databaseState: { isUnlocked: true },
        fetchAudioFilesWithUrls,
        getTrackIdsInPlaylist
      }
    );

    await waitFor(() => {
      expect(getTrackIdsInPlaylist).toHaveBeenCalledWith('playlist-1');
    });

    expect(fetchAudioFilesWithUrls).toHaveBeenCalledWith(['track-1'], false);

    await waitFor(() => {
      expect(screen.getByText('Playlist Song.mp3')).toBeInTheDocument();
    });
  });

  it('renders search input when tracks exist', async () => {
    const mockTrack = createMockAudioTrack();
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);

    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-audio-search')).toBeInTheDocument();
    });
  });

  it('filters tracks by search query', async () => {
    const tracks = [
      createMockAudioTrack({ id: 'track-1', name: 'Song One.mp3' }),
      createMockAudioTrack({ id: 'track-2', name: 'Song Two.mp3' })
    ];
    const fetchAudioFilesWithUrls = vi.fn(async () => tracks);

    const user = userEvent.setup();
    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-search');
    await user.type(searchInput, 'Two');

    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    const fetchAudioFilesWithUrls = vi.fn(async () => {
      throw new Error('Database error');
    });

    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('shows context menu on right click', async () => {
    const mockTrack = createMockAudioTrack({
      id: 'track-1',
      name: 'Test Song.mp3'
    });
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);

    const user = userEvent.setup();
    const Wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    render(
      <Wrapper>
        <AudioProvider>
          <AudioWindowList />
        </AudioProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Song.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Test Song.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
      expect(screen.getByText('Get info')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('renders dropzone when showDropzone is enabled and tracks are empty', async () => {
    const fetchAudioFilesWithUrls = vi.fn(async () => []);
    const onUploadFiles = vi.fn();

    renderWithAudioProvider(
      <AudioWindowList showDropzone={true} onUploadFiles={onUploadFiles} />,
      {
        databaseState: { isUnlocked: true },
        fetchAudioFilesWithUrls
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    });
  });

  it('renders audio player when tracks exist', async () => {
    const mockTrack = createMockAudioTrack();
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);

    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toBeInTheDocument();
    });
  });

  it('renders virtual list status when tracks exist', async () => {
    const mockTrack = createMockAudioTrack();
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);

    renderWithAudioProvider(<AudioWindowList />, {
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    await waitFor(() => {
      expect(screen.getByTestId('virtual-list-status')).toBeInTheDocument();
    });
  });

  it('calls softDeleteAudio when delete is clicked from context menu', async () => {
    const mockTrack = createMockAudioTrack({
      id: 'track-1',
      name: 'Test Song.mp3'
    });
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);
    const softDeleteAudio = vi.fn(async () => {});

    const user = userEvent.setup();
    const Wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls,
      softDeleteAudio
    });

    render(
      <Wrapper>
        <AudioProvider>
          <AudioWindowList />
        </AudioProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Song.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Test Song.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(softDeleteAudio).toHaveBeenCalledWith('track-1');
    });
  });

  it('calls restoreAudio when restore is clicked for deleted tracks', async () => {
    const mockTrack = createMockAudioTrack({
      id: 'track-1',
      name: 'Deleted Song.mp3',
      deleted: true
    });
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);
    const restoreAudio = vi.fn(async () => {});

    const user = userEvent.setup();
    const Wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls,
      restoreAudio
    });

    render(
      <Wrapper>
        <AudioProvider>
          <AudioWindowList showDeleted={true} />
        </AudioProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Deleted Song.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Deleted Song.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Restore')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Restore'));

    await waitFor(() => {
      expect(restoreAudio).toHaveBeenCalledWith('track-1');
    });
  });

  it('calls onSelectTrack when Get Info is clicked from context menu', async () => {
    const mockTrack = createMockAudioTrack({
      id: 'track-1',
      name: 'Test Song.mp3'
    });
    const fetchAudioFilesWithUrls = vi.fn(async () => [mockTrack]);
    const onSelectTrack = vi.fn();

    const user = userEvent.setup();
    const Wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchAudioFilesWithUrls
    });

    render(
      <Wrapper>
        <AudioProvider>
          <AudioWindowList onSelectTrack={onSelectTrack} />
        </AudioProvider>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Song.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Test Song.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get info'));

    expect(onSelectTrack).toHaveBeenCalledWith('track-1');
  });

  it('shows upload progress when uploading', () => {
    renderWithAudioProvider(
      <AudioWindowList uploading={true} uploadProgress={50} />,
      {
        databaseState: { isUnlocked: true }
      }
    );

    expect(screen.getByText('Uploading...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
