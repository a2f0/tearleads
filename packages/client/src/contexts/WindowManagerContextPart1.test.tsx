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

    it('opens window without dimensions on mobile viewport', () => {
      Object.defineProperty(window, 'innerWidth', {
        value: MOBILE_BREAKPOINT - 1,
        configurable: true
      });
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'mobile-window');
      });

      const win = result.current.getWindow('mobile-window');
      expect(win?.dimensions).toBeUndefined();
    });

    it('opens window without dimensions when innerHeight is zero', () => {
      Object.defineProperty(window, 'innerHeight', {
        value: 0,
        configurable: true
      });
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'zero-height-window');
      });

      const win = result.current.getWindow('zero-height-window');
      expect(win?.dimensions).toBeUndefined();
    });

    it('clamps dimensions when viewport height is limited', () => {
      Object.defineProperty(window, 'innerWidth', {
        value: 1200,
        configurable: true
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 500,
        configurable: true
      });
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'constrained-window');
      });

      const win = result.current.getWindow('constrained-window');
      expect(win?.dimensions).toBeDefined();
      expect(win?.dimensions?.height).toBeLessThanOrEqual(500);
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

    it('opens new window above the current top window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'window-1');
      });

      act(() => {
        result.current.openWindow('notes', 'window-2');
      });

      act(() => {
        result.current.focusWindow('window-1');
      });

      act(() => {
        result.current.openWindow('notes', 'window-3');
      });

      const window1 = result.current.windows.find((w) => w.id === 'window-1');
      const window3 = result.current.windows.find((w) => w.id === 'window-3');

      expect(window3?.zIndex).toBe((window1?.zIndex ?? 0) + 1);
    });

    it('restores existing audio window instead of opening another', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      let audioId = '';
      act(() => {
        audioId = result.current.openWindow('audio');
      });

      act(() => {
        result.current.minimizeWindow(audioId);
      });

      const minimizedAudio = result.current.getWindow(audioId);
      expect(minimizedAudio?.isMinimized).toBe(true);

      let reopenedId = '';
      act(() => {
        reopenedId = result.current.openWindow('audio');
      });

      expect(reopenedId).toBe(audioId);
      expect(result.current.windows).toHaveLength(1);
      expect(result.current.getWindow(audioId)?.isMinimized).toBe(false);
    });

    it('loads stored dimensions when preservation is enabled', () => {
      localStorage.setItem(
        'window-dimensions:notes',
        JSON.stringify({ width: 480, height: 320, x: 25, y: 30 })
      );
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'notes-1');
      });

      const window = result.current.getWindow('notes-1');
      expect(window?.dimensions).toEqual({
        width: 480,
        height: 320,
        x: 25,
        y: 30
      });
    });

    it('ignores stored dimensions when preservation is disabled', () => {
      setPreserveWindowState(false);
      localStorage.setItem(
        'window-dimensions:notes',
        JSON.stringify({ width: 480, height: 320, x: 25, y: 30 })
      );
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'notes-2');
      });

      const window = result.current.getWindow('notes-2');
      expect(window?.dimensions).toMatchObject({
        width: expect.any(Number),
        height: expect.any(Number),
        x: expect.any(Number),
        y: expect.any(Number)
      });
      expect(window?.dimensions).not.toEqual({
        width: 480,
        height: 320,
        x: 25,
        y: 30
      });
    });

    it('opens desktop windows with viewport-proportional landscape dimensions', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'notes-landscape');
      });

      const window = result.current.getWindow('notes-landscape');
      expect(window?.dimensions).toBeDefined();
      expect(
        (window?.dimensions?.width ?? 0) / (window?.dimensions?.height ?? 1)
      ).toBeGreaterThan(1);
    });

    it('offsets new desktop windows down and to the right of the top window', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'notes-1');
      });
      act(() => {
        result.current.openWindow('files', 'files-1');
      });

      const first = result.current.getWindow('notes-1')?.dimensions;
      const second = result.current.getWindow('files-1')?.dimensions;
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second?.x ?? 0).toBeGreaterThan(first?.x ?? 0);
      expect(second?.y ?? 0).toBeGreaterThan(first?.y ?? 0);
    });

    it('cascades from the highest z-index window when opening additional windows', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'notes-1');
      });
      act(() => {
        result.current.openWindow('files', 'files-1');
      });
      const second = result.current.getWindow('files-1')?.dimensions;

      act(() => {
        result.current.openWindow('health', 'health-1');
      });
      const third = result.current.getWindow('health-1')?.dimensions;

      expect(second).toBeDefined();
      expect(third).toBeDefined();
      expect(third?.x).toBe((second?.x ?? 0) + 36);
      expect(third?.y).toBe((second?.y ?? 0) + 28);
    });

    it('uses default placement when the top window has no dimensions', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      Object.defineProperty(window, 'innerWidth', {
        value: MOBILE_BREAKPOINT - 1,
        configurable: true
      });
      act(() => {
        result.current.openWindow('notes', 'mobile-no-dimensions');
      });

      Object.defineProperty(window, 'innerWidth', {
        value: 1440,
        configurable: true
      });
      Object.defineProperty(window, 'innerHeight', {
        value: 900,
        configurable: true
      });
      act(() => {
        result.current.openWindow('files', 'desktop-window');
      });

      expect(
        result.current.getWindow('mobile-no-dimensions')?.dimensions
      ).toBeUndefined();
      expect(result.current.getWindow('desktop-window')?.dimensions).toEqual({
        width: 734,
        height: 459,
        x: 353,
        y: 221
      });
    });

    it('reuses an existing typed window without mutating other windows', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.openWindow('notes', 'notes-1');
      });
      act(() => {
        result.current.openWindow('files', 'files-1');
      });

      const filesBefore = result.current.getWindow('files-1');
      let reopenedId = '';
      act(() => {
        reopenedId = result.current.openWindow('notes');
      });
      const filesAfter = result.current.getWindow('files-1');

      expect(reopenedId).toBe('notes-1');
      expect(filesBefore).toEqual(filesAfter);
    });
  });

  describe('requestWindowOpen', () => {
    it('stores window open requests with incrementing ids', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.requestWindowOpen('contacts', {
          contactId: 'contact-1'
        });
      });

      expect(result.current.windowOpenRequests.contacts?.contactId).toBe(
        'contact-1'
      );
      expect(result.current.windowOpenRequests.contacts?.requestId).toBe(1);

      act(() => {
        result.current.requestWindowOpen('contacts', {
          contactId: 'contact-1'
        });
      });

      expect(result.current.windowOpenRequests.contacts?.requestId).toBe(2);
    });

    it('stores email compose open requests', () => {
      const { result } = renderHook(() => useWindowManager(), { wrapper });

      act(() => {
        result.current.requestWindowOpen('email', {
          to: ['ada@example.com'],
          subject: 'Hello'
        });
      });

      expect(result.current.windowOpenRequests.email).toEqual({
        to: ['ada@example.com'],
        subject: 'Hello',
        requestId: 1
      });
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
});
