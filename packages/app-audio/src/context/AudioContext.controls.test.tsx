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

describe('useAudio controls', () => {
  describe('seek', () => {
    it('sets audio element currentTime', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.seek(30);
      });

      const audio = document.querySelector('audio');
      expect(audio?.currentTime).toBe(30);
    });

    it('no-ops when the audio element is missing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      result.current.audioElementRef.current = null;

      act(() => {
        result.current.seek(12);
      });

      const audio = document.querySelector('audio');
      expect(audio?.currentTime).toBe(0);
    });
  });

  describe('setVolume', () => {
    it('sets volume state', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.setVolume(0.5);
      });

      expect(result.current.volume).toBe(0.5);
    });

    it('sets audio element volume', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.setVolume(0.5);
      });

      const audio = document.querySelector('audio');
      expect(audio?.volume).toBe(0.5);
    });

    it('clamps volume to 0 minimum', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.setVolume(-0.5);
      });

      expect(result.current.volume).toBe(0);
    });

    it('clamps volume to 1 maximum', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.setVolume(1.5);
      });

      expect(result.current.volume).toBe(1);
    });

    it('no-ops on audio element when the ref is missing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      result.current.audioElementRef.current = null;

      act(() => {
        result.current.setVolume(0.25);
      });

      expect(result.current.volume).toBe(0.25);
      expect(mockPlay).not.toHaveBeenCalled();
    });
  });

  describe('track switching', () => {
    it('clears error when switching tracks', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.play(TEST_TRACK_2);
      });

      expect(result.current.error).toBeNull();
    });

    it('updates current track when switching', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      act(() => {
        result.current.play(TEST_TRACK_2);
      });

      expect(result.current.currentTrack).toEqual(TEST_TRACK_2);
    });
  });
});
