import type { WindowDimensions } from '@tearleads/window-manager';
import { lazy, Suspense, useCallback, useMemo } from 'react';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { WindowBundleLoadingShell } from './WindowBundleLoadingShell';

const windowRendererModulePromise = import('./WindowRenderer');

const DeferredWindowRenderer = lazy(() =>
  windowRendererModulePromise.then((module) => ({
    default: module.WindowRenderer
  }))
);

export function LazyWindowRenderer() {
  const {
    windows,
    closeWindow,
    focusWindow,
    minimizeWindow,
    updateWindowDimensions,
    saveWindowDimensionsForType,
    renameWindow
  } = useWindowManager();
  const visibleWindows = useMemo(
    () => windows.filter((window) => !window.isMinimized),
    [windows]
  );

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

  if (visibleWindows.length === 0) {
    return null;
  }

  return (
    <Suspense
      fallback={
        <WindowBundleLoadingShell
          windows={visibleWindows}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onDimensionsChange={handleDimensionsChange}
          onRename={renameWindow}
          onFocus={focusWindow}
        />
      }
    >
      <DeferredWindowRenderer />
    </Suspense>
  );
}
