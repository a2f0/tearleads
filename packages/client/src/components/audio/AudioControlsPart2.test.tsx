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
];describe('AudioControls', () => {

  beforeEach(() => {
    vi.clearAllMocks();
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
