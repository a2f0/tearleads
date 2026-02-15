import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCombinedRefresh } from './useCombinedRefresh.js';

describe('useCombinedRefresh', () => {
  it('starts with combinedRefreshToken at 0 when no external token', () => {
    const { result } = renderHook(() => useCombinedRefresh());

    expect(result.current.combinedRefreshToken).toBe(0);
  });

  it('starts with combinedRefreshToken equal to external token', () => {
    const { result } = renderHook(() => useCombinedRefresh(5));

    expect(result.current.combinedRefreshToken).toBe(5);
  });

  it('increments combinedRefreshToken when triggerRefresh is called', () => {
    const { result } = renderHook(() => useCombinedRefresh(0));

    act(() => result.current.triggerRefresh());
    expect(result.current.combinedRefreshToken).toBe(1);

    act(() => result.current.triggerRefresh());
    expect(result.current.combinedRefreshToken).toBe(2);
  });

  it('combines external and internal tokens', () => {
    const { result, rerender } = renderHook(
      ({ external }) => useCombinedRefresh(external),
      { initialProps: { external: 10 } }
    );

    expect(result.current.combinedRefreshToken).toBe(10);

    act(() => result.current.triggerRefresh());
    expect(result.current.combinedRefreshToken).toBe(11);

    rerender({ external: 20 });
    expect(result.current.combinedRefreshToken).toBe(21);
  });

  it('handles undefined external token', () => {
    const { result, rerender } = renderHook(
      ({ external }) => useCombinedRefresh(external),
      { initialProps: { external: undefined as number | undefined } }
    );

    expect(result.current.combinedRefreshToken).toBe(0);

    act(() => result.current.triggerRefresh());
    expect(result.current.combinedRefreshToken).toBe(1);

    rerender({ external: 5 });
    expect(result.current.combinedRefreshToken).toBe(6);
  });

  it('returns stable triggerRefresh function', () => {
    const { result, rerender } = renderHook(() => useCombinedRefresh());

    const firstTrigger = result.current.triggerRefresh;
    rerender();
    const secondTrigger = result.current.triggerRefresh;

    expect(firstTrigger).toBe(secondTrigger);
  });
});
