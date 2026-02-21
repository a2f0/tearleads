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

function wrapper({ children }: { children: React.ReactNode }) {
  return <AudioProvider>{children}</AudioProvider>;
}

describe('useAudio playback', () => {
  describe('play', () => {
    it('sets current track', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      expect(result.current.currentTrack).toEqual(TEST_TRACK);
    });

    it('calls audio element play', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      expect(mockPlay).toHaveBeenCalled();
    });

    it('sets audio element src', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = document.querySelector('audio');
      expect(audio?.src).toBe(TEST_TRACK.objectUrl);
    });

    it('no-ops when the audio element is missing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      result.current.audioElementRef.current = null;

      act(() => {
        result.current.play(TEST_TRACK);
      });

      expect(mockPlay).not.toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('calls audio element pause', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.pause();
      });

      expect(mockPause).toHaveBeenCalled();
    });

    it('does not clear current track', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.pause();
      });

      expect(result.current.currentTrack).toEqual(TEST_TRACK);
    });

    it('no-ops when the audio element is missing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      result.current.audioElementRef.current = null;

      act(() => {
        result.current.pause();
      });

      expect(mockPause).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('calls audio element play', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      mockPlay.mockClear();

      act(() => {
        result.current.resume();
      });

      expect(mockPlay).toHaveBeenCalled();
    });

    it('no-ops when there is no current track', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.resume();
      });

      expect(mockPlay).not.toHaveBeenCalled();
    });

    it('no-ops when the audio element is missing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      result.current.audioElementRef.current = null;

      act(() => {
        result.current.resume();
      });

      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('calls audio element pause', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.stop();
      });

      expect(mockPause).toHaveBeenCalled();
    });

    it('clears current track', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.stop();
      });

      expect(result.current.currentTrack).toBeNull();
    });

    it('resets isPlaying to false', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      // Simulate play event
      const audio = document.querySelector('audio');
      act(() => {
        audio?.dispatchEvent(new Event('play'));
      });

      act(() => {
        result.current.stop();
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it('clears any error', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.stop();
      });

      expect(result.current.error).toBeNull();
    });

    it('no-ops when the audio element is missing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      result.current.audioElementRef.current = null;

      act(() => {
        result.current.stop();
      });

      expect(mockPause).not.toHaveBeenCalled();
    });
  });
});
