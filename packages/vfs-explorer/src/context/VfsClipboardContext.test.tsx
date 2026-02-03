import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { useVfsClipboard, VfsClipboardProvider } from './VfsClipboardContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <VfsClipboardProvider>{children}</VfsClipboardProvider>
);

describe('VfsClipboardContext', () => {
  it('initializes with empty clipboard', () => {
    const { result } = renderHook(() => useVfsClipboard(), { wrapper });

    expect(result.current.clipboard.items).toEqual([]);
    expect(result.current.clipboard.operation).toBeNull();
    expect(result.current.hasItems).toBe(false);
    expect(result.current.isCut).toBe(false);
    expect(result.current.isCopy).toBe(false);
  });

  it('cuts items to clipboard', () => {
    const { result } = renderHook(() => useVfsClipboard(), { wrapper });

    const items = [{ id: '1', objectType: 'file' as const, name: 'test.txt' }];

    act(() => {
      result.current.cut(items);
    });

    expect(result.current.clipboard.items).toEqual(items);
    expect(result.current.clipboard.operation).toBe('cut');
    expect(result.current.hasItems).toBe(true);
    expect(result.current.isCut).toBe(true);
    expect(result.current.isCopy).toBe(false);
  });

  it('copies items to clipboard', () => {
    const { result } = renderHook(() => useVfsClipboard(), { wrapper });

    const items = [
      { id: '1', objectType: 'folder' as const, name: 'Documents' }
    ];

    act(() => {
      result.current.copy(items);
    });

    expect(result.current.clipboard.items).toEqual(items);
    expect(result.current.clipboard.operation).toBe('copy');
    expect(result.current.hasItems).toBe(true);
    expect(result.current.isCut).toBe(false);
    expect(result.current.isCopy).toBe(true);
  });

  it('clears clipboard', () => {
    const { result } = renderHook(() => useVfsClipboard(), { wrapper });

    const items = [{ id: '1', objectType: 'file' as const, name: 'test.txt' }];

    act(() => {
      result.current.cut(items);
    });

    expect(result.current.hasItems).toBe(true);

    act(() => {
      result.current.clear();
    });

    expect(result.current.clipboard.items).toEqual([]);
    expect(result.current.clipboard.operation).toBeNull();
    expect(result.current.hasItems).toBe(false);
  });

  it('replaces clipboard on new cut', () => {
    const { result } = renderHook(() => useVfsClipboard(), { wrapper });

    const firstItems = [
      { id: '1', objectType: 'file' as const, name: 'first.txt' }
    ];
    const secondItems = [
      { id: '2', objectType: 'folder' as const, name: 'second' }
    ];

    act(() => {
      result.current.cut(firstItems);
    });

    act(() => {
      result.current.copy(secondItems);
    });

    expect(result.current.clipboard.items).toEqual(secondItems);
    expect(result.current.clipboard.operation).toBe('copy');
  });

  it('handles multiple items', () => {
    const { result } = renderHook(() => useVfsClipboard(), { wrapper });

    const items = [
      { id: '1', objectType: 'file' as const, name: 'file1.txt' },
      { id: '2', objectType: 'file' as const, name: 'file2.txt' },
      { id: '3', objectType: 'folder' as const, name: 'folder1' }
    ];

    act(() => {
      result.current.cut(items);
    });

    expect(result.current.clipboard.items).toHaveLength(3);
    expect(result.current.hasItems).toBe(true);
  });

  it('throws error when used outside provider', () => {
    expect(() => {
      renderHook(() => useVfsClipboard());
    }).toThrow('useVfsClipboard must be used within a VfsClipboardProvider');
  });
});
