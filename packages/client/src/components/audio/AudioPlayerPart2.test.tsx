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
  useAudio: () => mockUseAudio(),
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
];describe('AudioPlayer', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    mockUseAudioAnalyser.mockReturnValue(new Uint8Array(12));
  });

  describe('visualizer visibility', () => {
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

    it('shows visualizer by default', () => {
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      expect(screen.getByTestId('visualizer-toggle')).toHaveAttribute(
        'aria-label',
        'Hide visualizer'
      );
    });

    it('persists toggled visibility', async () => {
      const user = userEvent.setup();
      render(<AudioPlayer tracks={TEST_TRACKS} />);

      await user.click(screen.getByTestId('visualizer-toggle'));

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'audio-visualizer-visible',
        'hidden'
      );
    });

    it('hides visualizer when visibility is hidden', () => {
      mockLocalStorage.setItem('audio-visualizer-visible', 'hidden');

      const { container } = render(<AudioPlayer tracks={TEST_TRACKS} />);

      const bars = container.querySelectorAll('.flex-col-reverse');
      expect(bars.length).toBe(0);
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

      const eqToggle = screen.getByTestId('visualizer-toggle');
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
