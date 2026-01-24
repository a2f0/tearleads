import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IsoCatalogEntry } from '@/lib/v86/types';
import { useV86 } from './useV86';

describe('useV86', () => {
  const mockIso: IsoCatalogEntry = {
    id: 'test-iso',
    name: 'Test ISO',
    description: 'A test operating system',
    downloadUrl: 'https://example.com/test.iso',
    sizeBytes: 104857600,
    bootType: 'cdrom',
    memoryMb: 256
  };

  const mockIsoUrl = 'blob:http://localhost/test-iso';

  it('returns initial state', () => {
    const { result } = renderHook(() =>
      useV86({ iso: mockIso, isoUrl: mockIsoUrl })
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.containerRef.current).toBeNull();
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.stop).toBe('function');
    expect(typeof result.current.restart).toBe('function');
  });

  it('sets error when container is not ready', async () => {
    const { result } = renderHook(() =>
      useV86({ iso: mockIso, isoUrl: mockIsoUrl })
    );

    // Call start without a container - wrapped in act
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe('Container not ready');
  });

  it('returns stable function references', () => {
    const { result, rerender } = renderHook(() =>
      useV86({ iso: mockIso, isoUrl: mockIsoUrl })
    );

    const { start, stop, restart } = result.current;

    rerender();

    expect(result.current.start).toBe(start);
    expect(result.current.stop).toBe(stop);
    expect(result.current.restart).toBe(restart);
  });
});
