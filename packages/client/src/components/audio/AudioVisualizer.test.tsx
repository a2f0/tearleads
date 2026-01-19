import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioVisualizer } from './AudioVisualizer';

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

const TEST_TRACK = {
  id: 'track-1',
  name: 'Test Song.mp3',
  objectUrl: 'blob:test-url',
  mimeType: 'audio/mpeg'
};

describe('AudioVisualizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    mockUseAudioAnalyser.mockReturnValue(new Uint8Array(12));
  });

  describe('when no track is loaded', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: false,
        currentTrack: null
      });
    });

    it('does not render', () => {
      render(<AudioVisualizer />);

      expect(screen.queryByTestId('audio-visualizer')).not.toBeInTheDocument();
    });
  });

  describe('when track is loaded but not playing', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: false,
        currentTrack: TEST_TRACK
      });
    });

    it('renders the visualizer with flatlined bars', () => {
      render(<AudioVisualizer />);

      expect(screen.getByTestId('audio-visualizer')).toBeInTheDocument();
    });
  });

  describe('when playing', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true,
        currentTrack: TEST_TRACK
      });
    });

    it('renders the visualizer', () => {
      render(<AudioVisualizer />);

      expect(screen.getByTestId('audio-visualizer')).toBeInTheDocument();
    });

    it('renders visibility toggle button', () => {
      render(<AudioVisualizer />);

      expect(screen.getByTestId('visualizer-toggle')).toBeInTheDocument();
    });

    it('shows visualizer by default', () => {
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Hide visualizer');
    });

    it('hides visualizer when toggle is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-toggle');
      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-label', 'Show visualizer');
    });

    it('saves visibility preference to localStorage', async () => {
      const user = userEvent.setup();
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-toggle');
      await user.click(toggle);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'audio-visualizer-visible',
        'hidden'
      );
    });

    it('loads hidden visibility from localStorage', () => {
      mockLocalStorage.getItem.mockReturnValue('hidden');
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Show visualizer');
    });

    it('loads visible visibility from localStorage', () => {
      mockLocalStorage.getItem.mockReturnValue('visible');
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Hide visualizer');
    });
  });

  describe('controlled visibility', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true,
        currentTrack: TEST_TRACK
      });
    });

    it('uses controlled visibility prop', () => {
      render(<AudioVisualizer visibility="hidden" />);

      const toggle = screen.getByTestId('visualizer-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Show visualizer');
    });

    it('calls onVisibilityChange when toggled', async () => {
      const user = userEvent.setup();
      const onVisibilityChange = vi.fn();
      render(
        <AudioVisualizer
          visibility="visible"
          onVisibilityChange={onVisibilityChange}
        />
      );

      const toggle = screen.getByTestId('visualizer-toggle');
      await user.click(toggle);

      expect(onVisibilityChange).toHaveBeenCalledWith('hidden');
    });

    it('saves controlled visibility to localStorage', () => {
      render(<AudioVisualizer visibility="hidden" />);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'audio-visualizer-visible',
        'hidden'
      );
    });
  });

  describe('localStorage error handling', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true,
        currentTrack: TEST_TRACK
      });
    });

    it('handles localStorage.getItem throwing', () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('localStorage disabled');
      });

      render(<AudioVisualizer />);

      expect(screen.getByTestId('audio-visualizer')).toBeInTheDocument();
    });

    it('handles localStorage.setItem throwing', async () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('localStorage disabled');
      });
      const user = userEvent.setup();

      render(<AudioVisualizer />);
      const toggle = screen.getByTestId('visualizer-toggle');
      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-label', 'Show visualizer');
    });
  });

  describe('frequency visualization', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true,
        currentTrack: TEST_TRACK
      });
    });

    it('renders bars with frequency data', () => {
      const frequencyData = new Uint8Array(12);
      frequencyData[0] = 255;
      frequencyData[5] = 128;
      frequencyData[11] = 64;
      mockUseAudioAnalyser.mockReturnValue(frequencyData);

      render(<AudioVisualizer />);

      expect(screen.getByTestId('audio-visualizer')).toBeInTheDocument();
    });

    it('does not render bars when hidden', () => {
      mockLocalStorage.getItem.mockReturnValue('hidden');
      const frequencyData = new Uint8Array(12).fill(200);
      mockUseAudioAnalyser.mockReturnValue(frequencyData);

      const { container } = render(<AudioVisualizer />);

      // Should only have the toggle button, no bars
      const bars = container.querySelectorAll('.flex-col-reverse');
      expect(bars.length).toBe(0);
    });
  });
});
