import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pushVfsBlobUploadActivity,
  resetVfsBlobUploadActivity,
  useVfsBlobUploadActivity
} from './vfsBlobUploadStore';

function makeEntry(id: string, kind = 'commit', success = true) {
  return {
    operationId: id,
    kind,
    success,
    timestamp: '2026-03-15T12:00:00.000Z',
    retryCount: 0
  };
}

describe('vfsBlobUploadStore', () => {
  afterEach(() => {
    act(() => {
      resetVfsBlobUploadActivity();
    });
  });

  it('starts empty and accumulates entries via the hook', () => {
    const { result } = renderHook(() => useVfsBlobUploadActivity());

    expect(result.current).toEqual([]);

    act(() => {
      pushVfsBlobUploadActivity(makeEntry('op-1', 'stage'));
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.operationId).toBe('op-1');
    expect(result.current[0]?.kind).toBe('stage');
  });

  it('resets to empty', () => {
    const { result } = renderHook(() => useVfsBlobUploadActivity());

    act(() => {
      pushVfsBlobUploadActivity(makeEntry('op-2'));
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      resetVfsBlobUploadActivity();
    });
    expect(result.current).toEqual([]);
  });

  it('reset is a no-op when already empty', () => {
    const { result } = renderHook(() => useVfsBlobUploadActivity());
    const ref = result.current;

    act(() => {
      resetVfsBlobUploadActivity();
    });
    expect(result.current).toBe(ref);
  });

  it('evicts oldest entries beyond ring buffer limit', () => {
    const { result } = renderHook(() => useVfsBlobUploadActivity());

    act(() => {
      for (let i = 0; i < 55; i++) {
        pushVfsBlobUploadActivity(makeEntry(`evict-${i}`));
      }
    });

    expect(result.current).toHaveLength(50);
    expect(result.current[0]?.operationId).toBe('evict-5');
    expect(result.current[49]?.operationId).toBe('evict-54');
  });

  it('preserves failure metadata', () => {
    const { result } = renderHook(() => useVfsBlobUploadActivity());

    act(() => {
      pushVfsBlobUploadActivity({
        operationId: 'fail-1',
        kind: 'attach',
        success: false,
        timestamp: '2026-03-15T12:01:00.000Z',
        retryCount: 2,
        failureClass: 'http_status'
      });
    });

    expect(result.current[0]).toEqual({
      operationId: 'fail-1',
      kind: 'attach',
      success: false,
      timestamp: '2026-03-15T12:01:00.000Z',
      retryCount: 2,
      failureClass: 'http_status'
    });
  });
});
