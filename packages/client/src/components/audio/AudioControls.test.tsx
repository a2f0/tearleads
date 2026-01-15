import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioControls } from './AudioControls';

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockSeek = vi.fn();
const mockCycleRepeatMode = vi.fn();
const mockSetOnTrackEnd = vi.fn();
const mockUseAudio = vi.fn();

vi.mock('@/audio', () => ({
  useAudio: () => mockUseAudio()
}));

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

describe('AudioControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when no track is playing', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        currentTrack: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });
    });

    it('does not render', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.queryByTestId('audio-controls')).not.toBeInTheDocument();
    });
  });

  describe('when track is playing', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 30,
        duration: 180,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });
    });

    it('renders the controls', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-controls')).toBeInTheDocument();
    });

    it('displays current time', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-current-time')).toHaveTextContent(
        '0:30'
      );
    });

    it('displays duration', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-duration')).toHaveTextContent('3:00');
    });

    it('renders the seekbar', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      const seekbar = screen.getByTestId('audio-seekbar');
      expect(seekbar).toBeInTheDocument();
      expect(seekbar).toHaveAttribute('type', 'range');
    });

    it('calls seek when seekbar is changed', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      const seekbar = screen.getByTestId('audio-seekbar');
      fireEvent.change(seekbar, { target: { value: '60' } });

      expect(mockSeek).toHaveBeenCalledWith(60);
    });

    it('renders pause button when playing', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /pause/i })
      ).toBeInTheDocument();
    });

    it('calls pause when pause button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioControls tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /pause/i }));

      expect(mockPause).toHaveBeenCalled();
    });

    it('renders restart button', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /restart/i })
      ).toBeInTheDocument();
    });

    it('calls seek with 0 when restart button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioControls tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /restart/i }));

      expect(mockSeek).toHaveBeenCalledWith(0);
    });

    it('renders previous track button', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /previous/i })
      ).toBeInTheDocument();
    });

    it('calls play with previous track when previous button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioControls tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /previous/i }));

      expect(mockPlay).toHaveBeenCalledWith(TEST_TRACKS[0]);
    });

    it('renders next track button', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('calls play with next track when next button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioControls tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /next/i }));

      expect(mockPlay).toHaveBeenCalledWith(TEST_TRACKS[2]);
    });
  });

  describe('when track is paused', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[1],
        isPlaying: false,
        currentTime: 30,
        duration: 180,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });
    });

    it('renders play button when paused', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /^play$/i })
      ).toBeInTheDocument();
    });

    it('calls resume when play button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioControls tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /^play$/i }));

      expect(mockResume).toHaveBeenCalled();
    });
  });

  describe('when on first track', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });
    });

    it('disables previous button', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('enables next button', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    });
  });

  describe('when on last track', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[2],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });
    });

    it('enables previous button', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(
        screen.getByRole('button', { name: /previous/i })
      ).not.toBeDisabled();
    });

    it('disables next button', () => {
      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });
  });

  describe('time formatting', () => {
    it('formats seconds correctly', () => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 65,
        duration: 3661,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-current-time')).toHaveTextContent(
        '1:05'
      );
      expect(screen.getByTestId('audio-duration')).toHaveTextContent('61:01');
    });

    it('handles zero duration', () => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: 0,
        duration: 0,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-duration')).toHaveTextContent('0:00');
    });

    it('handles invalid or negative times', () => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[0],
        isPlaying: true,
        currentTime: -5,
        duration: -10,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-current-time')).toHaveTextContent(
        '0:00'
      );
      expect(screen.getByTestId('audio-duration')).toHaveTextContent('0:00');
    });
  });

  describe('repeat button', () => {
    it('renders repeat button', () => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 30,
        duration: 180,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-repeat')).toBeInTheDocument();
    });

    it('calls cycleRepeatMode when clicked', async () => {
      const user = userEvent.setup();
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 30,
        duration: 180,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      await user.click(screen.getByTestId('audio-repeat'));

      expect(mockCycleRepeatMode).toHaveBeenCalled();
    });

    it.each([
      ['off', /repeat.*off/i],
      ['all', /repeat.*all/i],
      ['one', /repeat.*current/i]
    ] as const)('shows correct tooltip for repeat mode %s', (mode, pattern) => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 30,
        duration: 180,
        repeatMode: mode,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      const repeatButton = screen.getByTestId('audio-repeat');
      expect(repeatButton).toHaveAttribute(
        'title',
        expect.stringMatching(pattern)
      );
    });

    it('has highlighted style when repeat is enabled', () => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 30,
        duration: 180,
        repeatMode: 'all',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      const repeatButton = screen.getByTestId('audio-repeat');
      expect(repeatButton).toHaveClass('text-primary');
    });

    it('does not have highlighted style when repeat is off', () => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[1],
        isPlaying: true,
        currentTime: 30,
        duration: 180,
        repeatMode: 'off',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      const repeatButton = screen.getByTestId('audio-repeat');
      expect(repeatButton).not.toHaveClass('text-primary');
    });
  });

  describe('repeat all mode', () => {
    it('enables next button on last track when repeat all is on', () => {
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[2],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        repeatMode: 'all',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    });

    it('wraps to first track when clicking next on last track', async () => {
      const user = userEvent.setup();
      mockUseAudio.mockReturnValue({
        currentTrack: TEST_TRACKS[2],
        isPlaying: true,
        currentTime: 0,
        duration: 180,
        repeatMode: 'all',
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek,
        cycleRepeatMode: mockCycleRepeatMode,
        setOnTrackEnd: mockSetOnTrackEnd
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      await user.click(screen.getByRole('button', { name: /next/i }));

      expect(mockPlay).toHaveBeenCalledWith(TEST_TRACKS[0]);
    });
  });
});
