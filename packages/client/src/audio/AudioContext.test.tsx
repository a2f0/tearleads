import { act, render, renderHook, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
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

function getAudioElement(): HTMLAudioElement {
  const audio = document.querySelector('audio');
  if (!(audio instanceof HTMLAudioElement)) {
    throw new Error('Audio element not found');
  }
  return audio;
}

function NullAudioRef() {
  const { audioElementRef } = useAudio();

  useLayoutEffect(() => {
    audioElementRef.current = null;
  }, [audioElementRef]);

  return null;
}

describe('AudioProvider', () => {
  it('renders children', () => {
    render(
      <AudioProvider>
        <div data-testid="child">Test Child</div>
      </AudioProvider>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders a hidden audio element', () => {
    render(
      <AudioProvider>
        <div>Test</div>
      </AudioProvider>
    );

    const audio = document.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio).toHaveClass('hidden');
  });
});

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
  });

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

  describe('audio events', () => {
    it('sets isPlaying to true on play event', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = document.querySelector('audio');
      act(() => {
        audio?.dispatchEvent(new Event('play'));
      });

      expect(result.current.isPlaying).toBe(true);
    });

    it('sets isPlaying to false on pause event', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = document.querySelector('audio');
      act(() => {
        audio?.dispatchEvent(new Event('play'));
      });

      act(() => {
        audio?.dispatchEvent(new Event('pause'));
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it('sets isPlaying to false on ended event', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = document.querySelector('audio');
      act(() => {
        audio?.dispatchEvent(new Event('play'));
      });

      act(() => {
        audio?.dispatchEvent(new Event('ended'));
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it('updates duration on loadedmetadata event', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = getAudioElement();

      // Mock the duration property
      Object.defineProperty(audio, 'duration', {
        value: 180,
        writable: true
      });

      act(() => {
        audio.dispatchEvent(new Event('loadedmetadata'));
      });

      expect(result.current.duration).toBe(180);
    });

    it('throttles time updates to reduce re-renders', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      act(() => {
        result.current.play(TEST_TRACK);
      });

      const audio = getAudioElement();
      let nowValue = 300;
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowValue);

      act(() => {
        audio.currentTime = 5;
        audio.dispatchEvent(new Event('timeupdate'));
      });

      expect(result.current.currentTime).toBe(5);

      nowValue = 400;
      act(() => {
        audio.currentTime = 7;
        audio.dispatchEvent(new Event('timeupdate'));
      });

      expect(result.current.currentTime).toBe(5);

      nowValue = 600;
      act(() => {
        audio.currentTime = 9;
        audio.dispatchEvent(new Event('timeupdate'));
      });

      expect(result.current.currentTime).toBe(9);
      nowSpy.mockRestore();
    });

    it('skips event binding when the audio element ref is cleared', () => {
      render(
        <AudioProvider>
          <NullAudioRef />
        </AudioProvider>
      );

      const audio = document.querySelector('audio');
      expect(audio).toBeInTheDocument();
    });
  });

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

  describe('initial state', () => {
    it('has null error', () => {
      const { result } = renderHook(() => useAudio(), { wrapper });

      expect(result.current.error).toBeNull();
    });
  });
});
