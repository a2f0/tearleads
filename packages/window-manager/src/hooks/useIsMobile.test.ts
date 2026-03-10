import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from './useIsMobile';

describe('useIsMobile', () => {
  let listeners: Map<string, EventListener>;

  beforeEach(() => {
    listeners = new Map();
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (event: string, handler: EventListenerOrEventListenerObject) => {
        listeners.set(event, handler as EventListener);
      }
    );
    vi.spyOn(window, 'removeEventListener').mockImplementation(
      (event: string) => {
        listeners.delete(event);
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when window width is below 768', () => {
    vi.stubGlobal('innerWidth', 600);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    vi.unstubAllGlobals();
  });

  it('returns false when window width is at or above 768', () => {
    vi.stubGlobal('innerWidth', 768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    vi.unstubAllGlobals();
  });

  it('updates on resize', () => {
    vi.stubGlobal('innerWidth', 1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      vi.stubGlobal('innerWidth', 500);
      const resizeHandler = listeners.get('resize');
      resizeHandler?.(new Event('resize'));
    });

    expect(result.current).toBe(true);
    vi.unstubAllGlobals();
  });

  it('cleans up listener on unmount', () => {
    vi.stubGlobal('innerWidth', 1024);
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.has('resize')).toBe(true);
    unmount();
    expect(listeners.has('resize')).toBe(false);
    vi.unstubAllGlobals();
  });
});
