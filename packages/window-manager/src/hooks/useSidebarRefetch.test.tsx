import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSidebarRefetch } from './useSidebarRefetch.js';

describe('useSidebarRefetch', () => {
  it('does not refetch on initial render', () => {
    const refetch = vi.fn();
    renderHook(() => useSidebarRefetch(1, refetch));

    expect(refetch).not.toHaveBeenCalled();
  });

  it('does not refetch when refreshToken is undefined', () => {
    const refetch = vi.fn();
    renderHook(() => useSidebarRefetch(undefined, refetch));

    expect(refetch).not.toHaveBeenCalled();
  });

  it('refetches when refreshToken changes', () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ token }) => useSidebarRefetch(token, refetch),
      { initialProps: { token: 1 } }
    );

    expect(refetch).not.toHaveBeenCalled();

    rerender({ token: 2 });
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender({ token: 3 });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('does not refetch when refreshToken stays the same', () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(
      ({ token }) => useSidebarRefetch(token, refetch),
      { initialProps: { token: 1 } }
    );

    rerender({ token: 1 });
    rerender({ token: 1 });

    expect(refetch).not.toHaveBeenCalled();
  });

  it('handles async refetch functions', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ token }) => useSidebarRefetch(token, refetch),
      { initialProps: { token: 1 } }
    );

    rerender({ token: 2 });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
