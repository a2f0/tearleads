import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniPlayer } from './MiniPlayer';

// Mock the audio context
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockStop = vi.fn();
const mockSeek = vi.fn();
const mockUseAudioContext = vi.fn();
const mockUseLocation = vi.fn();
const mockUseWindowManager = vi.fn();
const mockUseIsMobile = vi.fn();

vi.mock('@/audio', () => ({
  useAudioContext: () => mockUseAudioContext()
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => mockUseLocation()
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => mockUseWindowManager()
}));

vi.mock('@/hooks/device', () => ({
  useIsMobile: () => mockUseIsMobile()
}));

const TEST_TRACK = {
  id: 'track-1',
  name: 'Test Song.mp3',
  objectUrl: 'blob:test-url',
  mimeType: 'audio/mpeg'
};

describe('MiniPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to desktop (non-mobile)
    mockUseIsMobile.mockReturnValue(false);
    // Default to a non-audio page
    mockUseLocation.mockReturnValue({ pathname: '/home' });
    mockUseWindowManager.mockReturnValue({
      windows: [],
      openWindow: vi.fn(),
      requestWindowOpen: vi.fn(),
      windowOpenRequests: {},
      closeWindow: vi.fn(),
      focusWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      restoreWindow: vi.fn(),
      updateWindowDimensions: vi.fn(),
      saveWindowDimensionsForType: vi.fn(),
      isWindowOpen: vi.fn(),
      getWindow: vi.fn()
    });
  });

  describe('when no audio context', () => {
    beforeEach(() => {
      mockUseAudioContext.mockReturnValue(null);
    });

    it('does not render', () => {
      render(<MiniPlayer />);

      expect(screen.queryByTestId('mini-player')).not.toBeInTheDocument();
    });
  });

  describe('when no track is loaded', () => {
    beforeEach(() => {
      mockUseAudioContext.mockReturnValue({
        currentTrack: null,
        isPlaying: false,
        pause: mockPause,
        resume: mockResume,
        stop: mockStop,
        seek: mockSeek
      });
    });

    it('does not render', () => {
      render(<MiniPlayer />);

      expect(screen.queryByTestId('mini-player')).not.toBeInTheDocument();
    });
  });

  describe('when track is paused', () => {
    beforeEach(() => {
      mockUseAudioContext.mockReturnValue({
        currentTrack: TEST_TRACK,
        isPlaying: false,
        pause: mockPause,
        resume: mockResume,
        stop: mockStop,
        seek: mockSeek
      });
    });

    it('does not render when audio is paused', () => {
      render(<MiniPlayer />);

      expect(screen.queryByTestId('mini-player')).not.toBeInTheDocument();
    });
  });

  describe('when on audio pages', () => {
    beforeEach(() => {
      mockUseAudioContext.mockReturnValue({
        currentTrack: TEST_TRACK,
        isPlaying: true,
        pause: mockPause,
        resume: mockResume,
        stop: mockStop,
        seek: mockSeek
      });
    });

    it.each([
      ['/audio'],
      ['/audio/123']
    ])('does not render on path %s', (pathname) => {
      mockUseLocation.mockReturnValue({ pathname });
      render(<MiniPlayer />);

      expect(screen.queryByTestId('mini-player')).not.toBeInTheDocument();
    });
  });

  describe('when track is playing', () => {
    beforeEach(() => {
      mockUseAudioContext.mockReturnValue({
        currentTrack: TEST_TRACK,
        isPlaying: true,
        pause: mockPause,
        resume: mockResume,
        stop: mockStop,
        seek: mockSeek
      });
    });

    it('renders the mini player', () => {
      render(<MiniPlayer />);

      expect(screen.getByTestId('mini-player')).toBeInTheDocument();
    });

    it('displays the track name', () => {
      render(<MiniPlayer />);

      expect(screen.getByText('Test Song.mp3')).toBeInTheDocument();
    });

    it('renders pause button when playing', () => {
      render(<MiniPlayer />);

      expect(
        screen.getByRole('button', { name: /pause/i })
      ).toBeInTheDocument();
    });

    it('calls pause when pause button is clicked', async () => {
      const user = userEvent.setup();
      render(<MiniPlayer />);

      await user.click(screen.getByRole('button', { name: /pause/i }));

      expect(mockPause).toHaveBeenCalled();
    });

    it('renders rewind button', () => {
      render(<MiniPlayer />);

      expect(
        screen.getByRole('button', { name: /rewind/i })
      ).toBeInTheDocument();
    });

    it('calls seek with 0 when rewind button is clicked', async () => {
      const user = userEvent.setup();
      render(<MiniPlayer />);

      await user.click(screen.getByRole('button', { name: /rewind/i }));

      expect(mockSeek).toHaveBeenCalledWith(0);
    });

    it('renders close button', () => {
      render(<MiniPlayer />);

      expect(
        screen.getByRole('button', { name: /close/i })
      ).toBeInTheDocument();
    });

    it('calls stop when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<MiniPlayer />);

      await user.click(screen.getByRole('button', { name: /close/i }));

      expect(mockStop).toHaveBeenCalled();
    });

    it('does not render when audio window is open', () => {
      mockUseWindowManager.mockReturnValue({
        windows: [
          {
            id: 'audio-1',
            type: 'audio',
            zIndex: 200,
            isMinimized: false,
            dimensions: {
              width: 450,
              height: 500,
              x: 100,
              y: 100,
              isMaximized: false
            }
          }
        ]
      });

      render(<MiniPlayer />);

      expect(screen.queryByTestId('mini-player')).not.toBeInTheDocument();
    });

    it('renders when audio window is minimized', () => {
      mockUseWindowManager.mockReturnValue({
        windows: [
          {
            id: 'audio-1',
            type: 'audio',
            zIndex: 200,
            isMinimized: true,
            dimensions: {
              width: 450,
              height: 500,
              x: 100,
              y: 100
            }
          }
        ]
      });

      render(<MiniPlayer />);

      expect(screen.getByTestId('mini-player')).toBeInTheDocument();
    });
  });

  it('renders resume controls when playback state flips after mount', async () => {
    const user = userEvent.setup();
    let readCount = 0;

    // Odd reads (visibility checks) return true so component renders;
    // even reads (destructuring) return false so button shows Play/resume.
    mockUseAudioContext.mockReturnValue({
      currentTrack: TEST_TRACK,
      get isPlaying() {
        readCount += 1;
        return readCount % 2 === 1;
      },
      pause: mockPause,
      resume: mockResume,
      stop: mockStop,
      seek: mockSeek
    });

    render(<MiniPlayer />);

    const playButton = screen.getByTestId('mini-player-play-pause');
    await user.click(playButton);

    expect(mockResume).toHaveBeenCalled();
  });
});
