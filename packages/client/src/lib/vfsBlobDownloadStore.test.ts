import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resetVfsBlobDownloadOperations,
  setVfsBlobDownloadOperations,
  useVfsBlobDownloadOperations
} from './vfsBlobDownloadStore';

const OPERATION = {
  operationId: 'download:blob-1',
  blobId: 'blob-1',
  itemId: 'item-1',
  sizeBytes: 128
};

describe('vfsBlobDownloadStore', () => {
  afterEach(() => {
    act(() => {
      resetVfsBlobDownloadOperations();
    });
  });

  it('publishes queued operations through the hook snapshot', () => {
    const { result } = renderHook(() => useVfsBlobDownloadOperations());

    expect(result.current).toEqual([]);

    act(() => {
      setVfsBlobDownloadOperations([OPERATION]);
    });

    expect(result.current).toEqual([OPERATION]);

    act(() => {
      resetVfsBlobDownloadOperations();
    });

    expect(result.current).toEqual([]);
  });

  it('keeps the same snapshot reference for equivalent operations', () => {
    const { result } = renderHook(() => useVfsBlobDownloadOperations());

    act(() => {
      setVfsBlobDownloadOperations([OPERATION]);
    });
    const firstSnapshot = result.current;

    act(() => {
      setVfsBlobDownloadOperations([{ ...OPERATION }]);
    });

    expect(result.current).toBe(firstSnapshot);
  });

  it('emits a new snapshot when operation metadata changes', () => {
    const { result } = renderHook(() => useVfsBlobDownloadOperations());

    act(() => {
      setVfsBlobDownloadOperations([OPERATION]);
    });
    const firstSnapshot = result.current;

    act(() => {
      setVfsBlobDownloadOperations([{ ...OPERATION, sizeBytes: 256 }]);
    });

    expect(result.current).not.toBe(firstSnapshot);
    expect(result.current).toEqual([
      {
        ...OPERATION,
        sizeBytes: 256
      }
    ]);
  });
});
