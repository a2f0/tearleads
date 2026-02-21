import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioProvider, useAudio } from './AudioContext';

// Mock HTMLAudioElement methods
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
    mockPlay
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
    mockPause
  );
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

const TEST_TRACK = {
  id: 'track-1',
  name: 'Test Song.mp3',
  objectUrl: 'blob:test-song-url',
  mimeType: 'audio/mpeg'
};

const TEST_TRACK_2 = {
  id: 'track-2',
  name: 'Another Song.mp3',
  objectUrl: 'blob:another-song-url',
  mimeType: 'audio/mpeg'
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <AudioProvider>{children}</AudioProvider>;
}

describe('useAudio playback queue transport', () => {
  it('starts with an empty playback queue', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    expect(result.current.playbackQueue).toEqual([]);
  });

  it('sets playback queue', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    act(() => {
      result.current.setPlaybackQueue?.([TEST_TRACK, TEST_TRACK_2]);
    });

    expect(result.current.playbackQueue).toEqual([TEST_TRACK, TEST_TRACK_2]);
  });

  it('skips to next track', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    act(() => {
      result.current.setPlaybackQueue?.([TEST_TRACK, TEST_TRACK_2]);
      result.current.play(TEST_TRACK);
    });

    act(() => {
      result.current.skipToNextTrack?.();
    });

    expect(result.current.currentTrack).toEqual(TEST_TRACK_2);
  });

  it('wraps to first track on next when repeat all is enabled', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    act(() => {
      result.current.setPlaybackQueue?.([TEST_TRACK, TEST_TRACK_2]);
      result.current.play(TEST_TRACK_2);
      result.current.setRepeatMode('all');
    });

    act(() => {
      result.current.skipToNextTrack?.();
    });

    expect(result.current.currentTrack).toEqual(TEST_TRACK);
  });

  it('skips to previous track', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    act(() => {
      result.current.setPlaybackQueue?.([TEST_TRACK, TEST_TRACK_2]);
      result.current.play(TEST_TRACK_2);
    });

    act(() => {
      result.current.skipToPreviousTrack?.();
    });

    expect(result.current.currentTrack).toEqual(TEST_TRACK);
  });

  it('wraps to last track on previous when repeat all is enabled', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    act(() => {
      result.current.setPlaybackQueue?.([TEST_TRACK, TEST_TRACK_2]);
      result.current.play(TEST_TRACK);
      result.current.setRepeatMode('all');
    });

    act(() => {
      result.current.skipToPreviousTrack?.();
    });

    expect(result.current.currentTrack).toEqual(TEST_TRACK_2);
  });

  it('plays track by id from queue', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    act(() => {
      result.current.setPlaybackQueue?.([TEST_TRACK, TEST_TRACK_2]);
    });

    act(() => {
      result.current.playTrackById?.(TEST_TRACK_2.id);
    });

    expect(result.current.currentTrack).toEqual(TEST_TRACK_2);
  });

  it('ignores unknown track id', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    act(() => {
      result.current.setPlaybackQueue?.([TEST_TRACK, TEST_TRACK_2]);
    });

    act(() => {
      result.current.playTrackById?.('missing-track');
    });

    expect(result.current.currentTrack).toBeNull();
  });
});
