import type { WindowDimensions } from '@tearleads/window-manager';
import { Suspense, useCallback, useMemo, useRef } from 'react';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { MemoizedWindow } from './MemoizedWindow';
import { WindowBundleLoadingShell } from './WindowBundleLoadingShell';
import { windowComponentMap } from './windowComponentMap';

export function WindowRenderer() {
  const {
    windows,
    closeWindow,
    focusWindow,
    minimizeWindow,
    saveWindowDimensionsForType,
    updateWindowDimensions,
    renameWindow
  } = useWindowManager();
  const windowsRef = useRef(windows);
  windowsRef.current = windows;

  const handleDimensionsChange = useCallback(
    (type: WindowType, id: string, dimensions: WindowDimensions) => {
      const { width, height, x, y, isMaximized } = dimensions;
      updateWindowDimensions(id, {
        width,
        height,
        x,
        y,
        ...(isMaximized !== undefined && { isMaximized })
      });
      saveWindowDimensionsForType(type, { width, height, x, y });
    },
    [saveWindowDimensionsForType, updateWindowDimensions]
  );

  const visibleWindows = useMemo(
    () => windows.filter((w) => !w.isMinimized),
    [windows]
  );

  const handleFocusWindow = useCallback(
    (id: string) => {
      const currentWindows = windowsRef.current;
      const targetWindow = currentWindows.find((window) => window.id === id);

      if (!targetWindow) {
        return;
      }

      const maxZIndex = Math.max(
        ...currentWindows.map((window) => window.zIndex)
      );
      if (targetWindow.zIndex === maxZIndex && !targetWindow.isMinimized) {
        return;
      }

      focusWindow(id);
    },
    [focusWindow]
  );

  if (visibleWindows.length === 0) {
    return null;
  }

  return (
    <>
      {/* Render all visible (non-minimized) windows */}
      {visibleWindows.map((window) => {
        const windowConfig = windowComponentMap[window.type];
        if (!windowConfig) {
          return null;
        }

        return (
          <Suspense
            key={window.id}
            fallback={
              <WindowBundleLoadingShell
                windows={[window]}
                onClose={closeWindow}
                onMinimize={minimizeWindow}
                onDimensionsChange={handleDimensionsChange}
                onRename={renameWindow}
                onFocus={handleFocusWindow}
              />
            }
          >
            <MemoizedWindow
              window={window}
              config={windowConfig}
              onClose={closeWindow}
              onMinimize={minimizeWindow}
              onDimensionsChange={handleDimensionsChange}
              onRename={renameWindow}
              onFocus={handleFocusWindow}
            />
          </Suspense>
        );
      })}
    </>
  );
}
