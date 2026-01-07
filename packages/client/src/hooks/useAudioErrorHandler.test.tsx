import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioProvider, useAudio } from '@/audio';
import { errorBoundaryRef } from '@/components/ui/error-boundary';
import { useAudioErrorHandler } from './useAudioErrorHandler';

// Mock HTMLAudioElement methods
const mockPlay = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
    mockPlay
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
    vi.fn()
  );
});

const TEST_TRACK = {
  id: 'track-1',
  name: 'Test Song.mp3',
  objectUrl: 'blob:test-song-url',
  mimeType: 'audio/mpeg'
};

function wrapper({ children }: { children: ReactNode }) {
  return <AudioProvider>{children}</AudioProvider>;
}

describe('useAudioErrorHandler', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let setErrorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setErrorSpy = vi.fn();
    // Mock errorBoundaryRef
    (
      errorBoundaryRef as { current: { setError: typeof setErrorSpy } | null }
    ).current = {
      setError: setErrorSpy
    };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    (errorBoundaryRef as { current: null }).current = null;
  });

  it('surfaces audio errors to the error boundary', async () => {
    mockPlay.mockRejectedValueOnce(new Error('Playback failed'));

    const { result } = renderHook(
      () => {
        const audio = useAudio();
        useAudioErrorHandler();
        return audio;
      },
      { wrapper }
    );

    await act(async () => {
      result.current.play(TEST_TRACK);
    });

    expect(setErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Test Song.mp3: Playback failed'
      })
    );
  });

  it('clears the error after surfacing it', async () => {
    mockPlay.mockRejectedValueOnce(new Error('Playback failed'));

    const { result } = renderHook(
      () => {
        const audio = useAudio();
        useAudioErrorHandler();
        return audio;
      },
      { wrapper }
    );

    await act(async () => {
      result.current.play(TEST_TRACK);
    });

    // Wait for the effect to clear the error
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBeNull();
  });

  it('does nothing when there is no error', () => {
    renderHook(
      () => {
        useAudioErrorHandler();
      },
      { wrapper }
    );

    expect(setErrorSpy).not.toHaveBeenCalled();
  });
});
