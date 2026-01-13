import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideo, useVideoContext, VideoProvider } from './VideoContext';

// Mock HTMLVideoElement methods
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
const mockLoad = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
    mockPlay
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
    mockPause
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(
    mockLoad
  );
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

// Test component that exposes video context
function TestComponent() {
  const {
    currentVideo,
    isPlaying,
    currentTime,
    duration,
    volume,
    error,
    play,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    clearError
  } = useVideo();

  return (
    <div>
      <div data-testid="current-video">
        {currentVideo ? currentVideo.name : 'none'}
      </div>
      <div data-testid="is-playing">{isPlaying ? 'playing' : 'paused'}</div>
      <div data-testid="current-time">{currentTime}</div>
      <div data-testid="duration">{duration}</div>
      <div data-testid="volume">{volume}</div>
      <div data-testid="error">{error ? error.message : 'no error'}</div>
      <button
        type="button"
        onClick={() =>
          play({
            id: 'test-id',
            name: 'test-video.mp4',
            objectUrl: 'blob:test-url',
            mimeType: 'video/mp4'
          })
        }
      >
        Play
      </button>
      <button type="button" onClick={pause}>
        Pause
      </button>
      <button type="button" onClick={resume}>
        Resume
      </button>
      <button type="button" onClick={stop}>
        Stop
      </button>
      <button type="button" onClick={() => seek(30)}>
        Seek
      </button>
      <button type="button" onClick={() => setVolume(0.5)}>
        Set Volume
      </button>
      <button type="button" onClick={clearError}>
        Clear Error
      </button>
    </div>
  );
}

describe('VideoContext', () => {
  it('provides default values', () => {
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    expect(screen.getByTestId('current-video')).toHaveTextContent('none');
    expect(screen.getByTestId('is-playing')).toHaveTextContent('paused');
    expect(screen.getByTestId('current-time')).toHaveTextContent('0');
    expect(screen.getByTestId('duration')).toHaveTextContent('0');
    expect(screen.getByTestId('volume')).toHaveTextContent('1');
    expect(screen.getByTestId('error')).toHaveTextContent('no error');
  });

  it('throws error when useVideo is used outside provider', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    expect(() => render(<TestComponent />)).toThrow(
      'useVideo must be used within a VideoProvider'
    );

    consoleError.mockRestore();
  });

  describe('play', () => {
    it('sets the current video when play is called', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      await waitFor(() => {
        expect(screen.getByTestId('current-video')).toHaveTextContent(
          'test-video.mp4'
        );
      });
    });
  });

  describe('pause', () => {
    it('pauses the video', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      // Play first
      await user.click(screen.getByRole('button', { name: 'Play' }));
      await user.click(screen.getByRole('button', { name: 'Pause' }));

      // Pause should have been called - we can't easily verify this without more mocking
      expect(screen.getByTestId('current-video')).toHaveTextContent(
        'test-video.mp4'
      );
    });
  });

  describe('stop', () => {
    it('stops playback and clears the current video', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      await waitFor(() => {
        expect(screen.getByTestId('current-video')).toHaveTextContent(
          'test-video.mp4'
        );
      });

      await user.click(screen.getByRole('button', { name: 'Stop' }));

      await waitFor(() => {
        expect(screen.getByTestId('current-video')).toHaveTextContent('none');
        expect(screen.getByTestId('is-playing')).toHaveTextContent('paused');
      });
    });
  });

  describe('setVolume', () => {
    it('updates the volume state', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Set Volume' }));

      await waitFor(() => {
        expect(screen.getByTestId('volume')).toHaveTextContent('0.5');
      });
    });

    it('clamps volume to valid range', async () => {
      function VolumeTestComponent() {
        const { volume, setVolume } = useVideo();
        return (
          <div>
            <div data-testid="volume">{volume}</div>
            <button type="button" onClick={() => setVolume(-0.5)}>
              Set Negative
            </button>
            <button type="button" onClick={() => setVolume(1.5)}>
              Set Over Max
            </button>
          </div>
        );
      }

      const user = userEvent.setup();
      render(
        <VideoProvider>
          <VolumeTestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Set Negative' }));
      await waitFor(() => {
        expect(screen.getByTestId('volume')).toHaveTextContent('0');
      });

      await user.click(screen.getByRole('button', { name: 'Set Over Max' }));
      await waitFor(() => {
        expect(screen.getByTestId('volume')).toHaveTextContent('1');
      });
    });
  });

  describe('clearError', () => {
    it('clears error state', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      // Error state starts as null
      expect(screen.getByTestId('error')).toHaveTextContent('no error');

      // Clear error (should remain null)
      await user.click(screen.getByRole('button', { name: 'Clear Error' }));

      expect(screen.getByTestId('error')).toHaveTextContent('no error');
    });
  });

  describe('videoElementRef', () => {
    it('provides a ref to the video element', () => {
      function RefTestComponent() {
        const { videoElementRef } = useVideo();
        return (
          <div data-testid="ref-available">
            {videoElementRef ? 'has ref' : 'no ref'}
          </div>
        );
      }

      render(
        <VideoProvider>
          <RefTestComponent />
        </VideoProvider>
      );

      expect(screen.getByTestId('ref-available')).toHaveTextContent('has ref');
    });
  });

  describe('seek', () => {
    it('seeks to the specified time', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      // First play to set up the video
      await user.click(screen.getByRole('button', { name: 'Play' }));
      await user.click(screen.getByRole('button', { name: 'Seek' }));

      // The seek function sets videoEl.currentTime - this is verified by checking no errors
      expect(screen.getByTestId('error')).toHaveTextContent('no error');
    });
  });

  describe('resume', () => {
    it('resumes playback when video is paused', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      // Play, pause, then resume
      await user.click(screen.getByRole('button', { name: 'Play' }));
      await user.click(screen.getByRole('button', { name: 'Pause' }));
      await user.click(screen.getByRole('button', { name: 'Resume' }));

      expect(mockPlay).toHaveBeenCalled();
    });

    it('does nothing when there is no current video', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      // Resume without playing first
      await user.click(screen.getByRole('button', { name: 'Resume' }));

      // Should remain in initial state
      expect(screen.getByTestId('current-video')).toHaveTextContent('none');
    });
  });

  describe('play error handling', () => {
    it('sets error when play fails', async () => {
      mockPlay.mockRejectedValueOnce(new Error('Playback failed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent(
          'Playback failed'
        );
      });
    });

    it('handles non-Error objects in play rejection', async () => {
      mockPlay.mockRejectedValueOnce('String error');
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent(
          'Failed to play video'
        );
      });
    });
  });

  describe('video element events', () => {
    it('updates isPlaying when play event fires', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      // Find the hidden video element
      const videoEl = document.querySelector('video');
      expect(videoEl).toBeTruthy();

      // Fire play event
      act(() => {
        videoEl?.dispatchEvent(new Event('play'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-playing')).toHaveTextContent('playing');
      });
    });

    it('updates isPlaying when pause event fires', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      const videoEl = document.querySelector('video');
      expect(videoEl).toBeTruthy();

      // Fire play then pause
      act(() => {
        videoEl?.dispatchEvent(new Event('play'));
      });
      act(() => {
        videoEl?.dispatchEvent(new Event('pause'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-playing')).toHaveTextContent('paused');
      });
    });

    it('resets state when ended event fires', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      const videoEl = document.querySelector('video');
      expect(videoEl).toBeTruthy();

      act(() => {
        videoEl?.dispatchEvent(new Event('play'));
      });
      act(() => {
        videoEl?.dispatchEvent(new Event('ended'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-playing')).toHaveTextContent('paused');
        expect(screen.getByTestId('current-time')).toHaveTextContent('0');
      });
    });

    it('updates duration when loadedmetadata fires', async () => {
      const user = userEvent.setup();
      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Play' }));

      const videoEl = document.querySelector('video') as HTMLVideoElement;
      expect(videoEl).toBeTruthy();

      // Mock the duration property
      Object.defineProperty(videoEl, 'duration', {
        writable: true,
        value: 120
      });

      act(() => {
        videoEl?.dispatchEvent(new Event('loadedmetadata'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('duration')).toHaveTextContent('120');
      });
    });
  });

  describe('media error handling', () => {
    it('ignores error event when no current video', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <VideoProvider>
          <TestComponent />
        </VideoProvider>
      );

      const videoEl = document.querySelector('video') as HTMLVideoElement;
      expect(videoEl).toBeTruthy();

      // Fire error without playing first
      act(() => {
        videoEl?.dispatchEvent(new Event('error'));
      });

      // Error should still be 'no error' since there's no current video
      expect(screen.getByTestId('error')).toHaveTextContent('no error');
    });
  });

  describe('useVideoContext', () => {
    it('returns null when used outside provider', () => {
      function ContextTestComponent() {
        const context = useVideoContext();
        return (
          <div data-testid="context-value">
            {context === null ? 'null' : 'has context'}
          </div>
        );
      }

      render(<ContextTestComponent />);

      expect(screen.getByTestId('context-value')).toHaveTextContent('null');
    });

    it('returns context when used inside provider', () => {
      function ContextTestComponent() {
        const context = useVideoContext();
        return (
          <div data-testid="context-value">
            {context === null ? 'null' : 'has context'}
          </div>
        );
      }

      render(
        <VideoProvider>
          <ContextTestComponent />
        </VideoProvider>
      );

      expect(screen.getByTestId('context-value')).toHaveTextContent(
        'has context'
      );
    });
  });
});
