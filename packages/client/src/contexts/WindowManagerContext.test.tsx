import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  useWindowManager,
  WindowManagerProvider
} from './WindowManagerContext';

describe('WindowManagerContext', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <WindowManagerProvider>{children}</WindowManagerProvider>;
  }

  describe('useWindowManager', () => {
    it('throws error when used outside WindowManagerProvider', () => {
      expect(() => {
        renderHook(() => useWindowManager());
      }).toThrow(
        'useWindowManager must be used within a WindowManagerProvider'
      );
    });

    it('returns context when used inside WindowManagerProvider', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      expect(result.current).toBeDefined();
      expect(result.current.windows).toEqual([]);
    });
  });

  describe('openWindow', () => {
    it('opens a new window with auto-generated id', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      let windowId = '';
      act(() => {
        windowId = result.current.openWindow('notes');
      });

      expect(result.current.windows).toHaveLength(1);
      expect(result.current.windows[0]?.id).toBe(windowId);
      expect(result.current.windows[0]?.type).toBe('notes');
      expect(result.current.windows[0]?.zIndex).toBe(100);
    });

    it('opens a window with custom id', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'custom-id');
      });

      expect(result.current.windows).toHaveLength(1);
      expect(result.current.windows[0]?.id).toBe('custom-id');
    });

    it('does not duplicate windows with same id', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'same-id');
      });

      act(() => {
        result.current.openWindow('notes', 'same-id');
      });

      expect(result.current.windows).toHaveLength(1);
    });

    it('increments z-index for each new window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'window-1');
      });

      act(() => {
        result.current.openWindow('notes', 'window-2');
      });

      const window1 = result.current.windows.find((w) => w.id === 'window-1');
      const window2 = result.current.windows.find((w) => w.id === 'window-2');

      expect(window1?.zIndex).toBe(100);
      expect(window2?.zIndex).toBe(101);
    });
  });

  describe('closeWindow', () => {
    it('removes window by id', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-close');
      });

      expect(result.current.windows).toHaveLength(1);

      act(() => {
        result.current.closeWindow('to-close');
      });

      expect(result.current.windows).toHaveLength(0);
    });

    it('does nothing when closing non-existent window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'existing');
      });

      act(() => {
        result.current.closeWindow('non-existent');
      });

      expect(result.current.windows).toHaveLength(1);
    });
  });

  describe('focusWindow', () => {
    it('brings window to front by updating z-index', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'window-1');
      });

      act(() => {
        result.current.openWindow('notes', 'window-2');
      });

      // window-2 should be on top initially
      const getWindow1 = () =>
        result.current.windows.find((w) => w.id === 'window-1');
      const getWindow2 = () =>
        result.current.windows.find((w) => w.id === 'window-2');

      expect(getWindow2()?.zIndex).toBeGreaterThan(getWindow1()?.zIndex ?? 0);

      // Focus window-1
      act(() => {
        result.current.focusWindow('window-1');
      });

      expect(getWindow1()?.zIndex).toBeGreaterThan(getWindow2()?.zIndex ?? 0);
    });

    it('does nothing when focusing already-focused window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'window-1');
      });

      const initialZIndex = result.current.windows[0]?.zIndex;

      act(() => {
        result.current.focusWindow('window-1');
      });

      expect(result.current.windows[0]?.zIndex).toBe(initialZIndex);
    });

    it('does nothing when focusing non-existent window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'existing');
      });

      const beforeFocus = [...result.current.windows];

      act(() => {
        result.current.focusWindow('non-existent');
      });

      expect(result.current.windows).toEqual(beforeFocus);
    });
  });

  describe('isWindowOpen', () => {
    it('returns true when window type is open', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      expect(result.current.isWindowOpen('notes')).toBe(false);

      act(() => {
        result.current.openWindow('notes');
      });

      expect(result.current.isWindowOpen('notes')).toBe(true);
    });

    it('returns true when specific window id is open', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'specific-id');
      });

      expect(result.current.isWindowOpen('notes', 'specific-id')).toBe(true);
      expect(result.current.isWindowOpen('notes', 'other-id')).toBe(false);
    });
  });

  describe('getWindow', () => {
    it('returns window instance by id', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'my-window');
      });

      const window = result.current.getWindow('my-window');
      expect(window).toBeDefined();
      expect(window?.id).toBe('my-window');
      expect(window?.type).toBe('notes');
    });

    it('returns undefined for non-existent window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      const window = result.current.getWindow('non-existent');
      expect(window).toBeUndefined();
    });
  });
});
