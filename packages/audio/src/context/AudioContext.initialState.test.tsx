import { renderHook } from '@testing-library/react';
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

describe('useAudio', () => {
  it('throws error when used outside AudioProvider', () => {
    expect(() => {
      renderHook(() => useAudio());
    }).toThrow('useAudio must be used within an AudioProvider');
  });

  describe('initial state', () => {
    it('has no current track', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      expect(result.current.currentTrack).toBeNull();
    });

    it('is not playing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      expect(result.current.isPlaying).toBe(false);
    });

    it('has zero current time', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      expect(result.current.currentTime).toBe(0);
    });

    it('has zero duration', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      expect(result.current.duration).toBe(0);
    });

    it('has volume set to 1', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      expect(result.current.volume).toBe(1);
    });

    it('has null error', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      expect(result.current.error).toBeNull();
    });
  });
});
