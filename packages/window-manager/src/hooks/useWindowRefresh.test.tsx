import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWindowRefresh } from './useWindowRefresh.js';

describe('useWindowRefresh', () => {
  it('starts with refreshToken at 0', () => {
    const { result } = renderHook(() => useWindowRefresh());

    expect(result.current.refreshToken).toBe(0);
  });

  it('increments refreshToken when triggerRefresh is called', () => {
    const { result } = renderHook(() => useWindowRefresh());

    act(() => result.current.triggerRefresh());
    expect(result.current.refreshToken).toBe(1);

    act(() => result.current.triggerRefresh());
    expect(result.current.refreshToken).toBe(2);
  });

  it('returns stable triggerRefresh function', () => {
    const { result, rerender } = renderHook(() => useWindowRefresh());

    const firstTrigger = result.current.triggerRefresh;
    rerender();
    const secondTrigger = result.current.triggerRefresh;

    expect(firstTrigger).toBe(secondTrigger);
  });
});
