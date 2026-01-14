import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioAnalyser } from './useAudioAnalyser';

// Mock Web Audio API
const mockAnalyser = {
  fftSize: 0,
  smoothingTimeConstant: 0,
  frequencyBinCount: 128,
  getByteFrequencyData: vi.fn((array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }),
  connect: vi.fn()
};

const mockSource = {
  connect: vi.fn()
};

let mockAudioContext: MockAudioContext | null = null;

class MockAudioContext {
  state: AudioContextState = 'running';
  createAnalyser = vi.fn(() => mockAnalyser);
  createMediaElementSource = vi.fn(() => mockSource);
  resume = vi.fn();
  close = vi.fn();
  destination = {};

  constructor() {
    mockAudioContext = this;
  }
}

// Store the original AudioContext
const originalAudioContext = global.AudioContext;

describe('useAudioAnalyser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock AudioContext constructor
    global.AudioContext = MockAudioContext;

    // Reset mock state
    if (mockAudioContext) {
      mockAudioContext.state = 'running';
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    global.AudioContext = originalAudioContext;
  });

  it('returns empty frequency data when not playing', () => {
    const audioElementRef = { current: document.createElement('audio') };

    const { result } = renderHook(() =>
      useAudioAnalyser(audioElementRef, false, 12)
    );

    expect(result.current).toBeInstanceOf(Uint8Array);
    expect(result.current.length).toBe(12);
    expect(result.current.every((v) => v === 0)).toBe(true);
  });

  it('returns empty frequency data when audio element is null', () => {
    const audioElementRef = { current: null };

    const { result } = renderHook(() =>
      useAudioAnalyser(audioElementRef, true, 12)
    );

    expect(result.current).toBeInstanceOf(Uint8Array);
    expect(result.current.length).toBe(12);
  });

  it('clears frequency data when playback stops', () => {
    const audioElementRef = { current: document.createElement('audio') };

    const { result, rerender } = renderHook(
      ({ isPlaying }) => useAudioAnalyser(audioElementRef, isPlaying, 12),
      { initialProps: { isPlaying: true } }
    );

    // Stop playback
    rerender({ isPlaying: false });

    expect(result.current.every((v) => v === 0)).toBe(true);
  });

  it('cancels animation frame on unmount', () => {
    const audioElementRef = { current: document.createElement('audio') };
    const cancelSpy = vi.spyOn(global, 'cancelAnimationFrame');

    const { unmount } = renderHook(() =>
      useAudioAnalyser(audioElementRef, true, 12)
    );

    // Trigger animation frame
    act(() => {
      vi.advanceTimersByTime(16);
    });

    unmount();

    expect(cancelSpy).toHaveBeenCalled();
  });

  it('handles different bar counts', () => {
    const audioElementRef = { current: null };

    const { result } = renderHook(() =>
      useAudioAnalyser(audioElementRef, false, 8)
    );

    expect(result.current.length).toBe(8);
  });

  it('resets data when isPlaying changes to false', () => {
    const audioElementRef = { current: null };

    const { result, rerender } = renderHook(
      ({ isPlaying }) => useAudioAnalyser(audioElementRef, isPlaying, 12),
      { initialProps: { isPlaying: true } }
    );

    rerender({ isPlaying: false });

    expect(result.current.every((v) => v === 0)).toBe(true);
  });
});
