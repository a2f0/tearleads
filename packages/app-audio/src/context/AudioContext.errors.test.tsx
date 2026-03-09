import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '../test/consoleMocks';
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

function getAudioElement(): HTMLAudioElement {
  const audio = document.querySelector('audio');
  if (!(audio instanceof HTMLAudioElement)) {
    throw new Error('Audio element not found');
  }
  return audio;
}

describe('useAudio error handling', () => {
  describe('play error handling', () => {
    let consoleSpy: ReturnType<typeof mockConsoleError>;

    beforeEach(() => {
      consoleSpy = mockConsoleError();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('sets isPlaying to false when play fails', async () => {
      mockPlay.mockRejectedValueOnce(new Error('Autoplay blocked'));

      const { result } = renderHook(() => useAudio(), { wrapper });

      await act(async () => {
        result.current.play(TEST_TRACK);
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it('sets error state with track info when play fails', async () => {
      mockPlay.mockRejectedValueOnce(new Error('Autoplay blocked'));

      const { result } = renderHook(() => useAudio(), { wrapper });

      await act(async () => {
        result.current.play(TEST_TRACK);
      });

      expect(result.current.error).toEqual({
        message: 'Autoplay blocked',
        trackId: TEST_TRACK.id,
        trackName: TEST_TRACK.name
      });
    });

    it('sets error state when resume fails', async () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      await act(async () => {
        result.current.play(TEST_TRACK);
      });

      mockPlay.mockRejectedValueOnce(new Error('Resume failed'));

      await act(async () => {
        result.current.resume();
      });

      expect(result.current.error).toEqual({
        message: 'Resume failed',
        trackId: TEST_TRACK.id,
        trackName: TEST_TRACK.name
      });
    });

    it('uses a fallback message when play rejects with a non-Error', async () => {
      mockPlay.mockRejectedValueOnce('Not an error');

      const { result } = renderHook(() => useAudio(), { wrapper });

      await act(async () => {
        result.current.play(TEST_TRACK);
      });

      expect(result.current.error).toEqual({
        message: 'Failed to play audio',
        trackId: TEST_TRACK.id,
        trackName: TEST_TRACK.name
      });
    });
  });

  describe('clearError', () => {
    let consoleSpy: ReturnType<typeof mockConsoleError>;

    beforeEach(() => {
      consoleSpy = mockConsoleError();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('clears the error state', async () => {
      mockPlay.mockRejectedValueOnce(new Error('Autoplay blocked'));

      const { result } = renderHook(() => useAudio(), { wrapper });

      await act(async () => {
        result.current.play(TEST_TRACK);
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('audio error event', () => {
    // MediaError constants: ABORTED=1, NETWORK=2, DECODE=3, SRC_NOT_SUPPORTED=4
    const MEDIA_ERR_ABORTED = 1;
    const MEDIA_ERR_NETWORK = 2;
    const MEDIA_ERR_DECODE = 3;
    const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

    let consoleSpy: ReturnType<typeof mockConsoleError>;

    beforeEach(() => {
      consoleSpy = mockConsoleError();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('sets error state when audio element emits error', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = getAudioElement();

      // Mock the error property
      Object.defineProperty(audio, 'error', {
        value: {
          code: MEDIA_ERR_SRC_NOT_SUPPORTED,
          message: 'Source not supported'
        },
        configurable: true
      });

      act(() => {
        audio.dispatchEvent(new Event('error'));
      });

      expect(result.current.error).toEqual({
        message: 'Audio file not found or format not supported',
        trackId: TEST_TRACK.id,
        trackName: TEST_TRACK.name
      });
      expect(result.current.isPlaying).toBe(false);
    });

    it('handles aborted playback error', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = getAudioElement();

      Object.defineProperty(audio, 'error', {
        value: {
          code: MEDIA_ERR_ABORTED,
          message: 'Playback aborted'
        },
        configurable: true
      });

      act(() => {
        audio.dispatchEvent(new Event('error'));
      });

      expect(result.current.error?.message).toBe('Audio playback was aborted');
    });

    it('handles network error', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = getAudioElement();

      Object.defineProperty(audio, 'error', {
        value: {
          code: MEDIA_ERR_NETWORK,
          message: 'Network error'
        },
        configurable: true
      });

      act(() => {
        audio.dispatchEvent(new Event('error'));
      });

      expect(result.current.error?.message).toBe(
        'A network error occurred while loading audio'
      );
    });

    it('handles decode error', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = getAudioElement();

      Object.defineProperty(audio, 'error', {
        value: {
          code: MEDIA_ERR_DECODE,
          message: 'Decode error'
        },
        configurable: true
      });

      act(() => {
        audio.dispatchEvent(new Event('error'));
      });

      expect(result.current.error?.message).toBe(
        'Audio file could not be decoded'
      );
    });

    it('keeps the default message when media error is missing', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = getAudioElement();

      Object.defineProperty(audio, 'error', {
        value: null,
        configurable: true
      });

      act(() => {
        audio.dispatchEvent(new Event('error'));
      });

      expect(result.current.error?.message).toBe('Failed to load audio');
    });

    it('returns early when no track is loaded', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      const audio = getAudioElement();

      Object.defineProperty(audio, 'error', {
        value: {
          code: MEDIA_ERR_NETWORK,
          message: 'Network error'
        },
        configurable: true
      });

      act(() => {
        audio.dispatchEvent(new Event('error'));
      });

      expect(result.current.error).toBeNull();
    });
  });
});
