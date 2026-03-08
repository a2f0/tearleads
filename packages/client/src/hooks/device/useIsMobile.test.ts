import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isViewportMobile, useIsMobile } from './useIsMobile';

describe('isViewportMobile', () => {
  it('returns false when no viewport is available', () => {
    expect(isViewportMobile(undefined, 768)).toBe(false);
  });

  it('compares viewport width against breakpoint', () => {
    expect(isViewportMobile({ innerWidth: 500 }, 768)).toBe(true);
    expect(isViewportMobile({ innerWidth: 1200 }, 768)).toBe(false);
  });
});

describe('useIsMobile', () => {
  it('updates on resize events', () => {
    const { result, unmount } = renderHook(() => useIsMobile(768));
    expect(result.current).toBe(window.innerWidth < 768);

    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 320
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(true);

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalWidth
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    unmount();
  });
});
