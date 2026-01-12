import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './AudioPlayer';

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockSeek = vi.fn();
const mockSetVolume = vi.fn();
const mockAudioElementRef = { current: null };
const mockUseAudio = vi.fn();
const mockUseAudioAnalyser = vi.fn();

vi.mock('@/audio', () => ({
  useAudio: () => mockUseAudio()
}));

vi.mock('@/audio/useAudioAnalyser', () => ({
  useAudioAnalyser: () => mockUseAudioAnalyser()
}));

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage
});

const TEST_TRACKS = [
  {
    id: 'track-1',
    name: 'First Song.mp3',
    objectUrl: 'blob:test-url-1',
    mimeType: 'audio/mpeg'
  },
  {
    id: 'track-2',
    name: 'Second Song.mp3',
    objectUrl: 'blob:test-url-2',
    mimeType: 'audio/mpeg'
  },
  {
    id: 'track-3',
    name: 'Third Song.mp3',
    objectUrl: 'blob:test-url-3',
    mimeType: 'audio/mpeg'
  }
];

describe('AudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    mockUseAudioAnalyser.mockReturnValue(new Uint8Array(12));
  });

  describe('when no track is loaded', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        volume: 1,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('does not render', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument();
    });
  });

  describe('when track is playing', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 30,
        duration: 180,
        volume: 1,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('renders the player', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-player')).toBeInTheDocument();
    });

    it('displays current time', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-current-time')).toHaveTextContent(
        '0:30'
      );
    });

    it('displays duration', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-duration')).toHaveTextContent('3:00');
    });

    it('renders the seekbar', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      const seekbar = screen.getByTestId('audio-seekbar');
      expect(seekbar).toBeInTheDocument();
      expect(seekbar).toHaveAttribute('type', 'range');
    });

    it('renders pause button when playing', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /pause/i })
      ).toBeInTheDocument();
    });

    it('calls pause when pause button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /pause/i }));

      expect(mockPause).toHaveBeenCalled();
    });

    it('renders restart button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /restart/i })
      ).toBeInTheDocument();
    });

    it('calls seek with 0 when restart button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /restart/i }));

      expect(mockSeek).toHaveBeenCalledWith(0);
    });

    it('renders previous track button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /previous/i })
      ).toBeInTheDocument();
    });

    it('calls play with previous track when previous button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /previous/i }));

      expect(mockPlay).toHaveBeenCalledWith(TEST_TRACKS[0]);
    });

    it('renders next track button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('calls play with next track when next button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /next/i }));

      expect(mockPlay).toHaveBeenCalledWith(TEST_TRACKS[2]);
    });

    it('renders visualizer style toggle', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('visualizer-style-toggle')).toBeInTheDocument();
    });
  });

  describe('when track is paused', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[1],
        isPlaying: false,
        currentTime: 30,
        duration: 180,
        volume: 1,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('renders play button when paused', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /^play$/i })
      ).toBeInTheDocument();
    });

    it('calls resume when play button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /^play$/i }));

      expect(mockResume).toHaveBeenCalled();
    });
  });

  describe('volume control', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        volume: 0.5,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('renders volume slider with ramp styling class', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      const volumeSlider = screen.getByTestId('audio-volume');
      expect(volumeSlider).toBeInTheDocument();
      expect(volumeSlider).toHaveClass('audio-slider-volume');
    });

    it('renders mute toggle button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-mute-toggle')).toBeInTheDocument();
    });

    it('calls setVolume when volume slider is changed', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      const volumeSlider = screen.getByTestId('audio-volume');
      fireEvent.change(volumeSlider, { target: { value: '0.8' } });

      expect(mockSetVolume).toHaveBeenCalledWith(0.8);
    });

    it('calls setVolume with 0 when mute button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByTestId('audio-mute-toggle'));

      expect(mockSetVolume).toHaveBeenCalledWith(0);
    });

    it('shows unmute icon when volume is 0', () => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        volume: 0,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });

      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /unmute/i })
      ).toBeInTheDocument();
    });

    it('calls setVolume with 1 when unmute button is clicked', async () => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        volume: 0,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });

      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByTestId('audio-mute-toggle'));

      expect(mockSetVolume).toHaveBeenCalledWith(1);
    });
  });

  describe('seek bar', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 60,
        duration: 180,
        volume: 1,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('renders seek slider with proper styling class', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      const seekbar = screen.getByTestId('audio-seekbar');
      expect(seekbar).toBeInTheDocument();
      expect(seekbar).toHaveClass('audio-slider-seek');
    });

    it('sets progress CSS variable based on current time', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      const seekbar = screen.getByTestId('audio-seekbar');
      expect(seekbar).toHaveStyle({ '--progress': '33.33333333333333%' });
    });
  });

  describe('layout and alignment', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        volume: 1,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('renders EQ toggle and playback controls in same row', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      const eqToggle = screen.getByTestId('visualizer-style-toggle');
      const playPause = screen.getByTestId('audio-play-pause');

      // Both should exist and be siblings in the same parent
      expect(eqToggle).toBeInTheDocument();
      expect(playPause).toBeInTheDocument();
      expect(eqToggle.parentElement).toBe(playPause.parentElement);
    });

    it('renders volume control in a separate centered row', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      const muteToggle = screen.getByTestId('audio-mute-toggle');
      const volumeSlider = screen.getByTestId('audio-volume');
      const playPause = screen.getByTestId('audio-play-pause');

      // Mute and volume should be in same parent
      expect(muteToggle.parentElement).toBe(volumeSlider.parentElement);
      // But different from playback controls
      expect(muteToggle.parentElement).not.toBe(playPause.parentElement);
    });
  });

  describe('when on first track', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        volume: 1,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('disables previous button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('enables next button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    });
  });

  describe('when on last track', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        currentTrack: TEST_TRACKS[2],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        volume: 1,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        setVolume: mockSetVolume
      });
    });

    it('enables previous button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /previous/i })
      ).not.toBeDisabled();
    });

    it('disables next button', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });
  });
});
