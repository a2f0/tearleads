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

describe('useAudio repeatMode', () => {
  it('has initial repeat mode of off', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });

    expect(result.current.repeatMode).toBe('off');
  });

  it('sets repeat mode directly', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });

    act(() => {
      result.current.setRepeatMode('all');
    });

    expect(result.current.repeatMode).toBe('all');
  });

  it('cycles from off to all', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });

    act(() => {
      result.current.cycleRepeatMode();
    });

    expect(result.current.repeatMode).toBe('all');
  });

  it('cycles from all to one', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });

    act(() => {
      result.current.setRepeatMode('all');
    });

    act(() => {
      result.current.cycleRepeatMode();
    });

    expect(result.current.repeatMode).toBe('one');
  });

  it('cycles from one to off', () => {
    const { result } = renderHook(() => useAudio(), { wrapper });

    act(() => {
      result.current.setRepeatMode('one');
    });

    act(() => {
      result.current.cycleRepeatMode();
    });

    expect(result.current.repeatMode).toBe('off');
  });
});
