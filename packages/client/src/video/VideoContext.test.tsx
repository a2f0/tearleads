import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideo, useVideoContext, VideoProvider } from './VideoContext';

beforeEach(() => {
  vi.clearAllMocks();
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
    setCurrentVideo,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    setError,
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
          setCurrentVideo({
            id: 'test-id',
            name: 'test-video.mp4',
            objectUrl: 'blob:test-url',
            mimeType: 'video/mp4'
          })
        }
      >
        Set Video
      </button>
      <button type="button" onClick={() => setIsPlaying(true)}>
        Set Playing
      </button>
      <button type="button" onClick={() => setIsPlaying(false)}>
        Set Paused
      </button>
      <button type="button" onClick={() => setCurrentVideo(null)}>
        Clear Video
      </button>
      <button type="button" onClick={() => setCurrentTime(30)}>
        Set Time
      </button>
      <button type="button" onClick={() => setDuration(120)}>
        Set Duration
      </button>
      <button type="button" onClick={() => setVolume(0.5)}>
        Set Volume
      </button>
      <button
        type="button"
        onClick={() =>
          setError({
            message: 'Test error',
            trackId: 'test-id',
            trackName: 'test-video.mp4'
          })
        }
      >
        Set Error
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

  it('sets current video when setCurrentVideo is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    await user.click(screen.getByText('Set Video'));

    expect(screen.getByTestId('current-video')).toHaveTextContent(
      'test-video.mp4'
    );
  });

  it('clears current video when setCurrentVideo(null) is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    await user.click(screen.getByText('Set Video'));
    expect(screen.getByTestId('current-video')).toHaveTextContent(
      'test-video.mp4'
    );

    await user.click(screen.getByText('Clear Video'));
    expect(screen.getByTestId('current-video')).toHaveTextContent('none');
  });

  it('updates playing state when setIsPlaying is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    expect(screen.getByTestId('is-playing')).toHaveTextContent('paused');

    await user.click(screen.getByText('Set Playing'));
    expect(screen.getByTestId('is-playing')).toHaveTextContent('playing');

    await user.click(screen.getByText('Set Paused'));
    expect(screen.getByTestId('is-playing')).toHaveTextContent('paused');
  });

  it('updates current time when setCurrentTime is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    await user.click(screen.getByText('Set Time'));

    expect(screen.getByTestId('current-time')).toHaveTextContent('30');
  });

  it('updates duration when setDuration is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    await user.click(screen.getByText('Set Duration'));

    expect(screen.getByTestId('duration')).toHaveTextContent('120');
  });

  it('updates volume when setVolume is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    await user.click(screen.getByText('Set Volume'));

    expect(screen.getByTestId('volume')).toHaveTextContent('0.5');
  });

  it('clamps volume to valid range', async () => {
    function VolumeTestComponent() {
      const { volume, setVolume } = useVideo();
      return (
        <div>
          <div data-testid="volume">{volume}</div>
          <button type="button" onClick={() => setVolume(2)}>
            Set High
          </button>
          <button type="button" onClick={() => setVolume(-1)}>
            Set Low
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

    await user.click(screen.getByText('Set High'));
    expect(screen.getByTestId('volume')).toHaveTextContent('1');

    await user.click(screen.getByText('Set Low'));
    expect(screen.getByTestId('volume')).toHaveTextContent('0');
  });

  it('sets error when setError is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    await user.click(screen.getByText('Set Error'));

    expect(screen.getByTestId('error')).toHaveTextContent('Test error');
  });

  it('clears error when clearError is called', async () => {
    const user = userEvent.setup();
    render(
      <VideoProvider>
        <TestComponent />
      </VideoProvider>
    );

    await user.click(screen.getByText('Set Error'));
    expect(screen.getByTestId('error')).toHaveTextContent('Test error');

    await user.click(screen.getByText('Clear Error'));
    expect(screen.getByTestId('error')).toHaveTextContent('no error');
  });
});

describe('useVideo', () => {
  it('throws error when used outside provider', () => {
    function ComponentWithoutProvider() {
      useVideo();
      return <div>Should not render</div>;
    }

    expect(() => {
      render(<ComponentWithoutProvider />);
    }).toThrow('useVideo must be used within a VideoProvider');
  });
});

describe('useVideoContext', () => {
  it('returns null when used outside provider', () => {
    function ComponentWithoutProvider() {
      const context = useVideoContext();
      return <div data-testid="result">{context ? 'has context' : 'null'}</div>;
    }

    render(<ComponentWithoutProvider />);
    expect(screen.getByTestId('result')).toHaveTextContent('null');
  });

  it('returns context when used inside provider', () => {
    function ComponentWithProvider() {
      const context = useVideoContext();
      return <div data-testid="result">{context ? 'has context' : 'null'}</div>;
    }

    render(
      <VideoProvider>
        <ComponentWithProvider />
      </VideoProvider>
    );
    expect(screen.getByTestId('result')).toHaveTextContent('has context');
  });
});
