import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSidebarDragOver } from './useSidebarDragOver.js';

describe('useSidebarDragOver', () => {
  it('tracks active drag target and clears after matching leaves', () => {
    const { result } = renderHook(() => useSidebarDragOver());

    expect(result.current.dragOverId).toBeNull();

    act(() => result.current.handleDragEnter('alpha'));
    act(() => result.current.handleDragEnter('alpha'));
    expect(result.current.dragOverId).toBe('alpha');

    act(() => result.current.handleDragLeave('alpha'));
    expect(result.current.dragOverId).toBe('alpha');

    act(() => result.current.handleDragLeave('alpha'));
    expect(result.current.dragOverId).toBeNull();
  });

  it('clears drag state unconditionally on drop clear', () => {
    const { result } = renderHook(() => useSidebarDragOver());

    act(() => result.current.handleDragEnter('alpha'));
    expect(result.current.dragOverId).toBe('alpha');

    act(() => result.current.clearDragState('beta'));
    expect(result.current.dragOverId).toBeNull();
  });
});
