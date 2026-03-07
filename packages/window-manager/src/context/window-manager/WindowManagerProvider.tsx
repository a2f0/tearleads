import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WindowDimensions } from '../../components/FloatingWindow.js';
import type { WindowInstance, WindowManagerProviderProps } from './types.js';
import { WindowManagerContext } from './WindowManagerContext.js';

const BASE_Z_INDEX = 100;

function getNextZIndex(currentWindows: WindowInstance[]): number {
  if (currentWindows.length === 0) {
    return BASE_Z_INDEX;
  }
  return Math.max(...currentWindows.map((w) => w.zIndex)) + 1;
}

function openWindowReducer(
  prev: WindowInstance[],
  type: string,
  defaultId: string,
  customId: string | undefined,
  savedDimensions: WindowDimensions | null,
  resolveInitialDimensions:
    | WindowManagerProviderProps['resolveInitialDimensions']
    | undefined,
  resolvedIdRef: { value: string }
): WindowInstance[] {
  if (!customId) {
    const existingByType = prev.find((w) => w.type === type);
    if (existingByType) {
      resolvedIdRef.value = existingByType.id;
      const nextZIndex = getNextZIndex(prev);
      return prev.map((w) =>
        w.id === existingByType.id
          ? { ...w, isMinimized: false, zIndex: nextZIndex }
          : w
      );
    }
  }

  const existing = prev.find((w) => w.id === defaultId);
  if (existing) {
    resolvedIdRef.value = existing.id;
    return prev;
  }

  const initialDimensions = resolveInitialDimensions
    ? resolveInitialDimensions({
        type,
        savedDimensions,
        currentWindows: prev
      })
    : (savedDimensions ?? undefined);

  const nextZIndex = getNextZIndex(prev);
  return [
    ...prev,
    {
      id: resolvedIdRef.value,
      type,
      zIndex: nextZIndex,
      isMinimized: false,
      ...(initialDimensions && { dimensions: initialDimensions })
    }
  ];
}

export function WindowManagerProvider({
  children,
  initialWindows,
  onWindowsChange,
  loadDimensions,
  saveDimensions,
  shouldPreserveState,
  createWindowId,
  resolveInitialDimensions
}: WindowManagerProviderProps) {
  const [windows, setWindows] = useState<WindowInstance[]>(
    initialWindows ?? []
  );
  const windowsRef = useRef<WindowInstance[]>(windows);
  windowsRef.current = windows;

  useEffect(() => {
    onWindowsChange?.(windows);
  }, [windows, onWindowsChange]);

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
      const defaultId = customId ?? createWindowId?.(type) ?? type;
      const existingWindow = customId
        ? windowsRef.current.find((window) => window.id === defaultId)
        : windowsRef.current.find((window) => window.type === type);
      const resolvedIdRef = { value: existingWindow?.id ?? defaultId };

      const preserveState = shouldPreserveState?.() ?? true;
      const savedDimensions =
        preserveState && loadDimensions ? loadDimensions(type) : null;

      setWindows((prev) =>
        openWindowReducer(
          prev,
          type,
          defaultId,
          customId,
          savedDimensions,
          resolveInitialDimensions,
          resolvedIdRef
        )
      );

      return resolvedIdRef.value;
    },
    [
      createWindowId,
      loadDimensions,
      resolveInitialDimensions,
      shouldPreserveState
    ]
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

  const renameWindow = useCallback((id: string, title: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, title: title || undefined } : w))
    );
  }, []);

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
      renameWindow,
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
      renameWindow,
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
