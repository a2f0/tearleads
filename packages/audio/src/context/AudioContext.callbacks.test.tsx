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

function wrapper({ children }: { children: React.ReactNode }) {
  return <AudioProvider>{children}</AudioProvider>;
}

function getAudioElement(): HTMLAudioElement {
  const audio = document.querySelector('audio');
  if (!(audio instanceof HTMLAudioElement)) {
    throw new Error('Audio element not found');
  }
  return audio;
}

describe('useAudio setOnTrackEnd', () => {
  it('registers a callback for track end', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    const callback = vi.fn();

    act(() => {
      result.current.setOnTrackEnd(callback);
    });

    const audio = getAudioElement();
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });

    expect(callback).toHaveBeenCalled();
  });

  it('can unregister the callback', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });
    const callback = vi.fn();

    act(() => {
      result.current.setOnTrackEnd(callback);
    });

    act(() => {
      result.current.setOnTrackEnd(undefined);
    });

    const audio = getAudioElement();
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });

    expect(callback).not.toHaveBeenCalled();
  });
});
