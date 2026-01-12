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

describe('AudioVisualizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    mockUseAudioAnalyser.mockReturnValue(new Uint8Array(12));
  });

  describe('when not playing', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: false
      });
    });

    it('does not render', () => {
      render(<AudioVisualizer />);

      expect(screen.queryByTestId('audio-visualizer')).not.toBeInTheDocument();
    });
  });

  describe('when playing', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true
      });
    });

    it('renders the visualizer', () => {
      render(<AudioVisualizer />);

      expect(screen.getByTestId('audio-visualizer')).toBeInTheDocument();
    });

    it('renders style toggle button', () => {
      render(<AudioVisualizer />);

      expect(screen.getByTestId('visualizer-style-toggle')).toBeInTheDocument();
    });

    it('uses lcd style by default', () => {
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-style-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Switch to gradient style');
    });

    it('toggles style when button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-style-toggle');
      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-label', 'Switch to LCD style');
    });

    it('saves style preference to localStorage', async () => {
      const user = userEvent.setup();
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-style-toggle');
      await user.click(toggle);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'audio-visualizer-style',
        'gradient'
      );
    });

    it('loads style preference from localStorage', () => {
      mockLocalStorage.getItem.mockReturnValue('gradient');
      render(<AudioVisualizer />);

      const toggle = screen.getByTestId('visualizer-style-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Switch to LCD style');
    });
  });

  describe('controlled style', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true
      });
    });

    it('uses controlled style prop', () => {
      render(<AudioVisualizer style="gradient" />);

      const toggle = screen.getByTestId('visualizer-style-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Switch to LCD style');
    });

    it('calls onStyleChange when toggled', async () => {
      const user = userEvent.setup();
      const onStyleChange = vi.fn();
      render(<AudioVisualizer style="lcd" onStyleChange={onStyleChange} />);

      const toggle = screen.getByTestId('visualizer-style-toggle');
      await user.click(toggle);

      expect(onStyleChange).toHaveBeenCalledWith('gradient');
    });

    it('saves controlled style to localStorage', () => {
      render(<AudioVisualizer style="gradient" />);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'audio-visualizer-style',
        'gradient'
      );
    });
  });

  describe('localStorage error handling', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true
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
      const toggle = screen.getByTestId('visualizer-style-toggle');
      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-label', 'Switch to LCD style');
    });
  });

  describe('frequency visualization', () => {
    beforeEach(() => {
      mockUseAudio.mockReturnValue({
        audioElementRef: mockAudioElementRef,
        isPlaying: true
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

    it('renders gradient style bars', () => {
      mockLocalStorage.getItem.mockReturnValue('gradient');
      const frequencyData = new Uint8Array(12).fill(200);
      mockUseAudioAnalyser.mockReturnValue(frequencyData);

      render(<AudioVisualizer />);

      expect(screen.getByTestId('audio-visualizer')).toBeInTheDocument();
    });
  });
});
