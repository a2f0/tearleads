import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT } from '@/constants/breakpoints';
import {
  clearPreserveWindowState,
  setPreserveWindowState
} from '@/lib/windowStatePreference';
import {
  useWindowManager,
  WindowManagerProvider
} from './WindowManagerContext';

describe('WindowManagerContext', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <WindowManagerProvider>{children}</WindowManagerProvider>;
  }

  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      configurable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true
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

  describe('minimizeWindow', () => {
    it('sets window isMinimized to true', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-minimize');
      });

      expect(result.current.windows[0]?.isMinimized).toBe(false);

      act(() => {
        result.current.minimizeWindow('to-minimize');
      });

      expect(result.current.windows[0]?.isMinimized).toBe(true);
    });

    it('stores dimensions when minimizing', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-minimize');
      });

      act(() => {
        result.current.minimizeWindow('to-minimize', {
          width: 500,
          height: 400,
          x: 100,
          y: 50
        });
      });

      const window = result.current.getWindow('to-minimize');
      expect(window?.dimensions).toEqual({
        width: 500,
        height: 400,
        x: 100,
        y: 50
      });
    });

    it('preserves existing dimensions when no new dimensions provided', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-minimize');
      });

      act(() => {
        result.current.updateWindowDimensions('to-minimize', {
          width: 600,
          height: 500,
          x: 150,
          y: 100
        });
      });

      act(() => {
        result.current.minimizeWindow('to-minimize');
      });

      const window = result.current.getWindow('to-minimize');
      expect(window?.dimensions).toEqual({
        width: 600,
        height: 500,
        x: 150,
        y: 100
      });
    });

    it('keeps dimensions undefined when minimizing a window without dimensions', () => {
      Object.defineProperty(window, 'innerWidth', {
        value: MOBILE_BREAKPOINT - 1,
        configurable: true
      });
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'mobile-window');
      });
      act(() => {
        result.current.minimizeWindow('mobile-window');
      });

      const mobileWindow = result.current.getWindow('mobile-window');
      expect(mobileWindow?.isMinimized).toBe(true);
      expect(mobileWindow?.dimensions).toBeUndefined();
    });
  });

  describe('restoreWindow', () => {
    it('sets window isMinimized to false', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-restore');
      });

      act(() => {
        result.current.minimizeWindow('to-restore');
      });

      expect(result.current.windows[0]?.isMinimized).toBe(true);

      act(() => {
        result.current.restoreWindow('to-restore');
      });

      expect(result.current.windows[0]?.isMinimized).toBe(false);
    });

    it('brings restored window to front', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'window-1');
      });

      act(() => {
        result.current.openWindow('notes', 'window-2');
      });

      act(() => {
        result.current.minimizeWindow('window-1');
      });

      act(() => {
        result.current.restoreWindow('window-1');
      });

      const window1 = result.current.windows.find((w) => w.id === 'window-1');
      const window2 = result.current.windows.find((w) => w.id === 'window-2');

      expect(window1?.zIndex).toBeGreaterThan(window2?.zIndex ?? 0);
    });
  });

  describe('updateWindowDimensions', () => {
    it('updates window dimensions', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-update');
      });

      act(() => {
        result.current.updateWindowDimensions('to-update', {
          width: 800,
          height: 600,
          x: 200,
          y: 150
        });
      });

      const window = result.current.getWindow('to-update');
      expect(window?.dimensions).toEqual({
        width: 800,
        height: 600,
        x: 200,
        y: 150
      });
    });

    it('leaves non-target windows unchanged', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-update');
      });
      act(() => {
        result.current.openWindow('files', 'untouched');
      });

      const untouchedBefore = result.current.getWindow('untouched');

      act(() => {
        result.current.updateWindowDimensions('to-update', {
          width: 800,
          height: 600,
          x: 200,
          y: 150
        });
      });

      expect(result.current.getWindow('untouched')).toEqual(untouchedBefore);
    });
  });

  describe('saveWindowDimensionsForType', () => {
    it('stores dimensions in localStorage', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.saveWindowDimensionsForType('notes', {
          width: 500,
          height: 400,
          x: 10,
          y: 20
        });
      });

      const saved = localStorage.getItem('window-dimensions:notes');
      expect(saved).not.toBeNull();
    });

    it('does not store dimensions when preservation is disabled', () => {
      setPreserveWindowState(false);
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.saveWindowDimensionsForType('notes', {
          width: 500,
          height: 400,
          x: 10,
          y: 20
        });
      });

      const saved = localStorage.getItem('window-dimensions:notes');
      expect(saved).toBeNull();
    });
  });

  describe('renameWindow', () => {
    it('updates window title', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'to-rename');
      });

      expect(result.current.getWindow('to-rename')?.title).toBeUndefined();

      act(() => {
        result.current.renameWindow('to-rename', 'My Custom Title');
      });

      expect(result.current.getWindow('to-rename')?.title).toBe(
        'My Custom Title'
      );
    });

    it('does nothing when renaming non-existent window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'existing');
      });

      const beforeRename = [...result.current.windows];

      act(() => {
        result.current.renameWindow('non-existent', 'New Title');
      });

      expect(result.current.windows).toEqual(beforeRename);
    });

    it('clears title when renamed with an empty string', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'empty-title-window');
      });
      act(() => {
        result.current.renameWindow('empty-title-window', 'temp title');
      });
      act(() => {
        result.current.renameWindow('empty-title-window', '');
      });

      expect(
        result.current.getWindow('empty-title-window')?.title
      ).toBeUndefined();
    });
  });
});
