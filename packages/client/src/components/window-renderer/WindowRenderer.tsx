import { useCallback } from 'react';
import { ConsoleWindow } from '@/components/console-window';
import { NotesWindow } from '@/components/notes-window';
import { SettingsWindow } from '@/components/settings-window';
import { useWindowManager } from '@/contexts/WindowManagerContext';

export function WindowRenderer() {
  const { windows, closeWindow, focusWindow, minimizeWindow } =
    useWindowManager();

  const handleCloseAll = useCallback(() => {
    for (const window of windows) {
      closeWindow(window.id);
    }
  }, [windows, closeWindow]);

  const visibleWindows = windows.filter((w) => !w.isMinimized);

  if (visibleWindows.length === 0) {
    return null;
  }

  return (
    <>
      {/* Backdrop - clicking closes all windows */}
      <div
        className="fixed inset-0 z-40"
        onClick={handleCloseAll}
        aria-hidden="true"
        data-testid="window-backdrop"
      />

      {/* Render all visible (non-minimized) windows */}
      {visibleWindows.map((window) => {
        switch (window.type) {
          case 'notes':
            return (
              <NotesWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'console':
            return (
              <ConsoleWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'settings':
            return (
              <SettingsWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
