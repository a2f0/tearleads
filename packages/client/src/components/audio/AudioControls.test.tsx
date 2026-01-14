import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioControls } from './AudioControls';

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockSeek = vi.fn();
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
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
        play: mockPlay,
        pause: mockPause,
        resume: mockResume,
        seek: mockSeek
      });

      render(<AudioControls tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('audio-current-time')).toHaveTextContent('0:00');
      expect(screen.getByTestId('audio-duration')).toHaveTextContent('0:00');
    });
  });
});
