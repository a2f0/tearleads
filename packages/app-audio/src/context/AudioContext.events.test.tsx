import { act, render, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
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

describe('useAudio audio events', () => {
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
