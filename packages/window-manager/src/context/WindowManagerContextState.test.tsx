import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadWindowDimensions,
  saveWindowDimensions
} from '../storage/windowDimensionsStorage.js';
import {
  clearPreserveWindowState,
  getPreserveWindowState,
  setPreserveWindowState
} from '../storage/windowStatePreference.js';
import {
  useWindowManager,
  WindowManagerProvider
} from './WindowManagerContext.js';

describe('WindowManagerContext window state management', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <WindowManagerProvider
        loadDimensions={loadWindowDimensions}
        saveDimensions={saveWindowDimensions}
        shouldPreserveState={getPreserveWindowState}
      >
        {children}
      </WindowManagerProvider>
    );
  }

  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
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
  });
});
