import { fireEvent, render, screen } from '@testing-library/react';
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
};describe('MiniPlayer', () => {

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

  describe('drag behavior (desktop)', () => {
    beforeEach(() => {
      mockUseIsMobile.mockReturnValue(false);
      mockUseAudioContext.mockReturnValue({
        currentTrack: TEST_TRACK,
        isPlaying: true,
        pause: mockPause,
        resume: mockResume,
        stop: mockStop,
        seek: mockSeek
      });
    });

    it('updates position on mousedown + mousemove', () => {
      render(<MiniPlayer />);
      const player = screen.getByTestId('mini-player');

      fireEvent.mouseDown(player, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(document, { clientX: 150, clientY: 120 });
      fireEvent.mouseUp(document);

      const style = player.style;
      expect(style.left).not.toBe('');
      expect(style.top).not.toBe('');
    });

    it('does not initiate drag from button clicks', async () => {
      const user = userEvent.setup();
      render(<MiniPlayer />);
      const player = screen.getByTestId('mini-player');
      const pauseButton = screen.getByRole('button', { name: /pause/i });

      const initialLeft = player.style.left;
      const initialTop = player.style.top;

      await user.click(pauseButton);

      expect(player.style.left).toBe(initialLeft);
      expect(player.style.top).toBe(initialTop);
      expect(mockPause).toHaveBeenCalled();
    });

    it('suppresses context menu after drag', () => {
      render(<MiniPlayer />);
      const player = screen.getByTestId('mini-player');

      // Drag beyond threshold
      fireEvent.mouseDown(player, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(document, { clientX: 120, clientY: 120 });
      fireEvent.mouseUp(document);

      // Right-click after drag should not open context menu
      fireEvent.contextMenu(player);

      expect(
        screen.queryByRole('button', { name: 'Restore' })
      ).not.toBeInTheDocument();
    });

    it('cleans up document listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(<MiniPlayer />);

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'mousemove',
        expect.any(Function)
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'mouseup',
        expect.any(Function)
      );

      removeEventListenerSpy.mockRestore();
    });
  });

  describe('drag behavior (mobile)', () => {
    beforeEach(() => {
      mockUseIsMobile.mockReturnValue(true);
      mockUseAudioContext.mockReturnValue({
        currentTrack: TEST_TRACK,
        isPlaying: true,
        pause: mockPause,
        resume: mockResume,
        stop: mockStop,
        seek: mockSeek
      });
    });

    it('does not use absolute positioning on mobile', () => {
      render(<MiniPlayer />);
      const player = screen.getByTestId('mini-player');

      expect(player.style.left).toBe('');
      expect(player.style.top).toBe('');
    });
  });
});
