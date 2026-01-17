import { useCallback } from 'react';
import { NotesWindow } from '@/components/notes-window';
import { useWindowManager } from '@/contexts/WindowManagerContext';

export function WindowRenderer() {
  const { windows, closeWindow, focusWindow } = useWindowManager();

  const handleCloseAll = useCallback(() => {
    for (const window of windows) {
      closeWindow(window.id);
    }
  }, [windows, closeWindow]);

  if (windows.length === 0) {
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

      {/* Render all open windows */}
      {windows.map((window) => {
        switch (window.type) {
          case 'notes':
            return (
              <NotesWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
