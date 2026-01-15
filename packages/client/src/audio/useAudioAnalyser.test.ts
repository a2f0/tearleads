import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError, mockConsoleWarn } from '@/test/console-mocks';

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
let useAudioAnalyser: typeof import('./useAudioAnalyser').useAudioAnalyser;

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
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

describe('useAudioAnalyser', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.resetModules();

    // Mock AudioContext constructor
    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal(
      'requestAnimationFrame',
      (_callback: FrameRequestCallback) => 1
    );
    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

    // Reset mock state
    if (mockAudioContext) {
      mockAudioContext.state = 'running';
    }

    ({ useAudioAnalyser } = await import('./useAudioAnalyser'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('AudioContext', originalAudioContext);
    vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', originalCancelAnimationFrame);
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

  it('cancels animation frame when playback stops', () => {
    const audioElementRef = { current: document.createElement('audio') };
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 1);
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');

    const { rerender } = renderHook(
      ({ isPlaying }) => useAudioAnalyser(audioElementRef, isPlaying, 12),
      { initialProps: { isPlaying: true } }
    );

    rerender({ isPlaying: false });

    expect(cancelSpy).toHaveBeenCalledWith(1);

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('resumes suspended audio context during updates', () => {
    const audioElementRef = { current: document.createElement('audio') };
    let storedCallback: FrameRequestCallback | null = null;
    const frameSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        storedCallback = callback;
        return 1;
      });

    renderHook(() => useAudioAnalyser(audioElementRef, true, 12));

    if (mockAudioContext) {
      mockAudioContext.state = 'suspended';
    }

    act(() => {
      storedCallback?.(0);
    });

    expect(mockAudioContext?.resume).toHaveBeenCalled();
    frameSpy.mockRestore();
  });

  it('logs initialization errors', async () => {
    const consoleSpy = mockConsoleError();

    class ThrowingAudioContext {
      constructor() {
        throw new Error('Boom');
      }
    }

    vi.stubGlobal('AudioContext', ThrowingAudioContext);
    vi.resetModules();
    ({ useAudioAnalyser } = await import('./useAudioAnalyser'));
    const audioElementRef = { current: document.createElement('audio') };

    renderHook(() => useAudioAnalyser(audioElementRef, true, 12));

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to initialize audio analyser:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('warns when connecting to a different audio element', async () => {
    const warnSpy = mockConsoleWarn();
    const firstRef = { current: document.createElement('audio') };
    const secondRef = { current: document.createElement('audio') };

    renderHook(() => useAudioAnalyser(firstRef, true, 12));
    await act(async () => {});
    renderHook(() => useAudioAnalyser(secondRef, true, 12));

    expect(warnSpy).toHaveBeenCalledWith(
      'Audio analyser already connected to a different element'
    );

    warnSpy.mockRestore();
  });

  it('updates frequency data from the analyser', () => {
    const audioElementRef = { current: document.createElement('audio') };
    const dataValues = [10, 20, 30, 40, 50, 60, 70, 80];
    let storedCallback: FrameRequestCallback | null = null;

    mockAnalyser.frequencyBinCount = dataValues.length;
    mockAnalyser.getByteFrequencyData = vi.fn((array: Uint8Array) => {
      dataValues.forEach((value, index) => {
        array[index] = value;
      });
    });

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (callback) => {
        storedCallback = callback;
        return 1;
      }
    );

    const { result } = renderHook(() =>
      useAudioAnalyser(audioElementRef, true, 4)
    );

    act(() => {
      storedCallback?.(0);
    });

    expect(result.current).toEqual(new Uint8Array([15, 35, 55, 75]));
  });

  it('handles update when analyser is unavailable', () => {
    const audioElementRef = { current: null };
    let storedCallback: FrameRequestCallback | null = null;

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (callback) => {
        storedCallback = callback;
        return 1;
      }
    );

    const { result } = renderHook(() =>
      useAudioAnalyser(audioElementRef, true, 4)
    );

    act(() => {
      storedCallback?.(0);
    });

    expect(result.current.every((value) => value === 0)).toBe(true);
  });
});
