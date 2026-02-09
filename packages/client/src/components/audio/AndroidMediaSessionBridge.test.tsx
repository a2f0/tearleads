import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidMediaSessionBridge } from './AndroidMediaSessionBridge';

const mockUseAudio = vi.fn();
const mockAddListener = vi.fn();
const mockUpdatePlaybackState = vi.fn();
const mockUpdateMetadata = vi.fn();
const mockUpdateCatalog = vi.fn();
const mockClearMetadata = vi.fn();
const mockIsAndroidNativePlatform = vi.fn();

vi.mock('@/audio', () => ({
  useAudio: () => mockUseAudio()
}));

vi.mock('@/plugins/mediaSessionBridge', () => ({
  isAndroidNativePlatform: () => mockIsAndroidNativePlatform(),
  MediaSessionBridge: {
    addListener: (...args: unknown[]) => mockAddListener(...args),
    updatePlaybackState: (...args: unknown[]) =>
      mockUpdatePlaybackState(...args),
    updateMetadata: (...args: unknown[]) => mockUpdateMetadata(...args),
    updateCatalog: (...args: unknown[]) => mockUpdateCatalog(...args),
    clearMetadata: (...args: unknown[]) => mockClearMetadata(...args)
  }
}));

describe('AndroidMediaSessionBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddListener.mockResolvedValue({ remove: vi.fn() });
    mockUpdatePlaybackState.mockResolvedValue(undefined);
    mockUpdateMetadata.mockResolvedValue(undefined);
    mockUpdateCatalog.mockResolvedValue(undefined);
    mockClearMetadata.mockResolvedValue(undefined);
    mockIsAndroidNativePlatform.mockReturnValue(true);
    mockUseAudio.mockReturnValue({
      currentTrack: null,
      playbackQueue: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      pause: vi.fn(),
      resume: vi.fn(),
      seek: vi.fn(),
      playTrackById: vi.fn(),
      skipToNextTrack: vi.fn(),
      skipToPreviousTrack: vi.fn(),
      stop: vi.fn()
    });
  });

  it('syncs playback and metadata for android', () => {
    mockUseAudio.mockReturnValue({
      currentTrack: {
        id: 'track-1',
        name: 'Track One',
        objectUrl: 'blob:1',
        mimeType: 'audio/mpeg'
      },
      playbackQueue: [
        {
          id: 'track-1',
          name: 'Track One',
          objectUrl: 'blob:1',
          mimeType: 'audio/mpeg'
        }
      ],
      isPlaying: false,
      currentTime: 0,
      duration: 120,
      pause: vi.fn(),
      resume: vi.fn(),
      seek: vi.fn(),
      playTrackById: vi.fn(),
      skipToNextTrack: vi.fn(),
      skipToPreviousTrack: vi.fn(),
      stop: vi.fn()
    });

    render(<AndroidMediaSessionBridge />);

    expect(mockAddListener).toHaveBeenCalledWith(
      'transportControl',
      expect.any(Function)
    );
    expect(mockUpdatePlaybackState).toHaveBeenCalled();
    expect(mockUpdateCatalog).toHaveBeenCalledWith({
      tracks: [{ id: 'track-1', title: 'Track One' }]
    });
    expect(mockUpdateMetadata).toHaveBeenCalledWith({
      title: 'Track One',
      durationMs: 120000
    });
  });

  it('routes transport events to audio actions', async () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const seek = vi.fn();
    const playTrackById = vi.fn();
    const next = vi.fn();
    const previous = vi.fn();
    const stop = vi.fn();
    mockUseAudio.mockReturnValue({
      currentTrack: null,
      playbackQueue: [],
      isPlaying: true,
      currentTime: 0,
      duration: 0,
      pause,
      resume,
      seek,
      playTrackById,
      skipToNextTrack: next,
      skipToPreviousTrack: previous,
      stop
    });

    render(<AndroidMediaSessionBridge />);
    const eventHandler = mockAddListener.mock.calls[0]?.[1] as
      | ((event: {
          action: string;
          positionMs?: number;
          mediaId?: string;
        }) => void)
      | undefined;
    expect(eventHandler).toBeDefined();

    eventHandler?.({ action: 'play' });
    eventHandler?.({ action: 'play', mediaId: 'track-2' });
    eventHandler?.({ action: 'pause' });
    eventHandler?.({ action: 'next' });
    eventHandler?.({ action: 'previous' });
    eventHandler?.({ action: 'stop' });
    eventHandler?.({ action: 'seekTo', positionMs: 2500 });
    eventHandler?.({ action: 'togglePlayPause' });

    expect(resume).toHaveBeenCalled();
    expect(playTrackById).toHaveBeenCalledWith('track-2');
    expect(pause).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(previous).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(seek).toHaveBeenCalledWith(2.5);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('resumes on togglePlayPause when currently paused', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    mockUseAudio.mockReturnValue({
      currentTrack: null,
      playbackQueue: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      pause,
      resume,
      seek: vi.fn(),
      playTrackById: vi.fn(),
      skipToNextTrack: vi.fn(),
      skipToPreviousTrack: vi.fn(),
      stop: vi.fn()
    });

    render(<AndroidMediaSessionBridge />);
    const eventHandler = mockAddListener.mock.calls[0]?.[1] as
      | ((event: { action: string }) => void)
      | undefined;

    eventHandler?.({ action: 'togglePlayPause' });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('does nothing on non-android platforms', () => {
    mockIsAndroidNativePlatform.mockReturnValue(false);

    render(<AndroidMediaSessionBridge />);

    expect(mockAddListener).not.toHaveBeenCalled();
    expect(mockUpdatePlaybackState).not.toHaveBeenCalled();
  });

  it('removes listener on unmount', async () => {
    const remove = vi.fn();
    mockAddListener.mockResolvedValue({ remove });

    const result = render(<AndroidMediaSessionBridge />);
    result.unmount();

    await Promise.resolve();
    expect(remove).toHaveBeenCalled();
  });

  it('clears existing playback sync interval before replacing it', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const audioState = {
      currentTrack: null,
      playbackQueue: [],
      isPlaying: false,
      currentTime: 0,
      duration: 10,
      pause: vi.fn(),
      resume: vi.fn(),
      seek: vi.fn(),
      playTrackById: vi.fn(),
      skipToNextTrack: vi.fn(),
      skipToPreviousTrack: vi.fn(),
      stop: vi.fn()
    };
    mockUseAudio.mockImplementation(() => audioState);

    const { rerender } = render(<AndroidMediaSessionBridge />);
    audioState.currentTime = 1;
    rerender(<AndroidMediaSessionBridge />);

    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });
});
