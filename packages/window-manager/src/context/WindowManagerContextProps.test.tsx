// one-component-per-file: allow -- test file with multiple wrapper components
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadWindowDimensions,
  saveWindowDimensions
} from '../storage/windowDimensionsStorage.js';
import {
  clearPreserveWindowState,
  getPreserveWindowState
} from '../storage/windowStatePreference.js';
import {
  useWindowManager,
  WindowManagerProvider
} from './WindowManagerContext.js';

describe('WindowManagerContext props', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
  });

  describe('initialWindows', () => {
    it('starts with provided initial windows', () => {
      const initial = [
        { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false },
        { id: 'w2', type: 'files', zIndex: 101, isMinimized: true }
      ];

      function initialWrapper({ children }: { children: ReactNode }) {
        return (
          <WindowManagerProvider
            initialWindows={initial}
            loadDimensions={loadWindowDimensions}
            saveDimensions={saveWindowDimensions}
            shouldPreserveState={getPreserveWindowState}
          >
            {children}
          </WindowManagerProvider>
        );
      }

      const { result } = renderHook(() => useWindowManager(), {
        wrapper: initialWrapper
      });

      expect(result.current.windows).toHaveLength(2);
      expect(result.current.windows[0]?.id).toBe('w1');
      expect(result.current.windows[1]?.id).toBe('w2');
      expect(result.current.windows[1]?.isMinimized).toBe(true);
    });

    it('defaults to empty array when initialWindows not provided', () => {
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

      const { result } = renderHook(() => useWindowManager(), { wrapper });
      expect(result.current.windows).toEqual([]);
    });
  });

  describe('onWindowsChange', () => {
    it('fires when a window is opened', () => {
      const onChange = vi.fn();

      function changeWrapper({ children }: { children: ReactNode }) {
        return (
          <WindowManagerProvider
            onWindowsChange={onChange}
            loadDimensions={loadWindowDimensions}
            saveDimensions={saveWindowDimensions}
            shouldPreserveState={getPreserveWindowState}
          >
            {children}
          </WindowManagerProvider>
        );
      }

      const { result } = renderHook(() => useWindowManager(), {
        wrapper: changeWrapper
      });

      onChange.mockClear();

      act(() => {
        result.current.openWindow('notes', 'w1');
      });

      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'w1' })])
      );
    });

    it('fires when a window is closed', () => {
      const onChange = vi.fn();

      function changeWrapper({ children }: { children: ReactNode }) {
        return (
          <WindowManagerProvider
            onWindowsChange={onChange}
            loadDimensions={loadWindowDimensions}
            saveDimensions={saveWindowDimensions}
            shouldPreserveState={getPreserveWindowState}
          >
            {children}
          </WindowManagerProvider>
        );
      }

      const { result } = renderHook(() => useWindowManager(), {
        wrapper: changeWrapper
      });

      act(() => {
        result.current.openWindow('notes', 'w1');
      });

      onChange.mockClear();

      act(() => {
        result.current.closeWindow('w1');
      });

      expect(onChange).toHaveBeenCalledWith([]);
    });

    it('fires when a window is minimized', () => {
      const onChange = vi.fn();

      function changeWrapper({ children }: { children: ReactNode }) {
        return (
          <WindowManagerProvider
            onWindowsChange={onChange}
            loadDimensions={loadWindowDimensions}
            saveDimensions={saveWindowDimensions}
            shouldPreserveState={getPreserveWindowState}
          >
            {children}
          </WindowManagerProvider>
        );
      }

      const { result } = renderHook(() => useWindowManager(), {
        wrapper: changeWrapper
      });

      act(() => {
        result.current.openWindow('notes', 'w1');
      });

      onChange.mockClear();

      act(() => {
        result.current.minimizeWindow('w1');
      });

      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'w1', isMinimized: true })
        ])
      );
    });
  });
});
