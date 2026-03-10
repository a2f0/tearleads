import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useWindowSidebar,
  type WindowSidebarContextValue,
  WindowSidebarProvider
} from './WindowSidebarContext';

describe('WindowSidebarContext', () => {
  it('returns default values when used outside provider', () => {
    const { result } = renderHook(() => useWindowSidebar());
    expect(result.current.isMobileDrawer).toBe(false);
    expect(result.current.closeSidebar).toBeTypeOf('function');
    result.current.closeSidebar(); // no-op, should not throw
  });

  it('returns provided values when used inside provider', () => {
    const closeSidebar = vi.fn();
    const value: WindowSidebarContextValue = {
      closeSidebar,
      isMobileDrawer: true
    };

    const { result } = renderHook(() => useWindowSidebar(), {
      wrapper: ({ children }) => (
        <WindowSidebarProvider value={value}>{children}</WindowSidebarProvider>
      )
    });

    expect(result.current.isMobileDrawer).toBe(true);
    result.current.closeSidebar();
    expect(closeSidebar).toHaveBeenCalled();
  });
});
