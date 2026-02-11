import { useCallback, useMemo, useState } from 'react';
import type { WindowDimensions } from '../../components/FloatingWindow.js';
import { generateUniqueId } from '../../lib/utils.js';
import type { WindowInstance, WindowManagerProviderProps } from './types.js';
import { WindowManagerContext } from './WindowManagerContext.js';

const BASE_Z_INDEX = 100;

export function WindowManagerProvider({
  children,
  loadDimensions,
  saveDimensions,
  shouldPreserveState
}: WindowManagerProviderProps) {
  const [windows, setWindows] = useState<WindowInstance[]>([]);

  const getNextZIndex = useCallback((currentWindows: WindowInstance[]) => {
    if (currentWindows.length === 0) {
      return BASE_Z_INDEX;
    }
    return Math.max(...currentWindows.map((w) => w.zIndex)) + 1;
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const windowToFocus = prev.find((w) => w.id === id);
      if (!windowToFocus) return prev;

      const maxZIndex = Math.max(...prev.map((w) => w.zIndex));
      if (windowToFocus.zIndex === maxZIndex && !windowToFocus.isMinimized) {
        return prev;
      }

      return prev.map((w) =>
        w.id === id ? { ...w, zIndex: maxZIndex + 1, isMinimized: false } : w
      );
    });
  }, []);

  const openWindow = useCallback(
    (type: string, customId?: string): string => {
      const id = customId ?? generateUniqueId(type);
      const existingWindow = customId
        ? undefined
        : windows.find((window) => window.type === type);
      let resolvedId = existingWindow?.id ?? id;

      const preserveState = shouldPreserveState?.() ?? true;
      const savedDimensions =
        preserveState && loadDimensions ? loadDimensions(type) : null;

      setWindows((prev) => {
        if (!customId) {
          const existingByType = prev.find((w) => w.type === type);
          if (existingByType) {
            resolvedId = existingByType.id;
            const nextZIndex = getNextZIndex(prev);
            return prev.map((w) =>
              w.id === existingByType.id
                ? { ...w, isMinimized: false, zIndex: nextZIndex }
                : w
            );
          }
        }

        const existing = prev.find((w) => w.id === id);
        if (existing) {
          resolvedId = existing.id;
          return prev;
        }

        const nextZIndex = getNextZIndex(prev);
        return [
          ...prev,
          {
            id,
            type,
            zIndex: nextZIndex,
            isMinimized: false,
            ...(savedDimensions && { dimensions: savedDimensions })
          }
        ];
      });

      return resolvedId;
    },
    [getNextZIndex, loadDimensions, shouldPreserveState, windows]
  );

  const minimizeWindow = useCallback(
    (id: string, dimensions?: WindowDimensions) => {
      setWindows((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w;
          const newDimensions = dimensions ?? w.dimensions;
          return newDimensions
            ? { ...w, isMinimized: true, dimensions: newDimensions }
            : { ...w, isMinimized: true };
        })
      );
    },
    []
  );

  const restoreWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const maxZIndex = Math.max(...prev.map((w) => w.zIndex));
      return prev.map((w) =>
        w.id === id ? { ...w, isMinimized: false, zIndex: maxZIndex + 1 } : w
      );
    });
  }, []);

  const updateWindowDimensions = useCallback(
    (id: string, dimensions: WindowDimensions) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, dimensions } : w))
      );
    },
    []
  );

  const saveWindowDimensionsForType = useCallback(
    (type: string, dimensions: WindowDimensions) => {
      const { width, height, x, y } = dimensions;
      const preserveState = shouldPreserveState?.() ?? true;
      if (!preserveState || !saveDimensions) {
        return;
      }
      saveDimensions(type, { width, height, x, y });
    },
    [saveDimensions, shouldPreserveState]
  );

  const isWindowOpen = useCallback(
    (type: string, id?: string): boolean => {
      if (id) {
        return windows.some((w) => w.id === id);
      }
      return windows.some((w) => w.type === type);
    },
    [windows]
  );

  const getWindow = useCallback(
    (id: string): WindowInstance | undefined => {
      return windows.find((w) => w.id === id);
    },
    [windows]
  );

  const value = useMemo(
    () => ({
      windows,
      openWindow,
      closeWindow,
      focusWindow,
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      isWindowOpen,
      getWindow
    }),
    [
      windows,
      openWindow,
      closeWindow,
      focusWindow,
      minimizeWindow,
      restoreWindow,
      updateWindowDimensions,
      saveWindowDimensionsForType,
      isWindowOpen,
      getWindow
    ]
  );

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  );
}
