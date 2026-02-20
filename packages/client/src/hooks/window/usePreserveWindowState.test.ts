import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreserveWindowState } from './usePreserveWindowState';

const mockGetPreserveWindowState = vi.fn();
const mockSetPreserveWindowState = vi.fn();
const mockSubscribePreserveWindowState = vi.fn((_: () => void) => () => {});

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    getPreserveWindowState: () => mockGetPreserveWindowState(),
    setPreserveWindowState: (next: boolean) => mockSetPreserveWindowState(next),
    subscribePreserveWindowState: (callback: () => void) =>
      mockSubscribePreserveWindowState(callback)
  };
});

describe('usePreserveWindowState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPreserveWindowState.mockReturnValue(false);
  });

  it('returns the current preference from the store', () => {
    const { result } = renderHook(() => usePreserveWindowState());

    expect(result.current.preserveWindowState).toBe(false);
    expect(mockSubscribePreserveWindowState).toHaveBeenCalledTimes(1);
  });

  it('updates the preference through the setter', () => {
    const { result } = renderHook(() => usePreserveWindowState());

    act(() => {
      result.current.setPreserveWindowState(true);
    });

    expect(mockSetPreserveWindowState).toHaveBeenCalledWith(true);
  });
});
