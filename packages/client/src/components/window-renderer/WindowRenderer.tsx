import { useCallback } from 'react';
import { AdminWindow } from '@/components/admin-window';
import { AdminPostgresWindow } from '@/components/admin-postgres-window';
import { AnalyticsWindow } from '@/components/analytics-window';
import { AudioWindow } from '@/components/audio-window';
import { CacheStorageWindow } from '@/components/cache-storage-window';
import { ChatWindow } from '@/components/chat-window';
import { ConsoleWindow } from '@/components/console-window';
import { ContactsWindow } from '@/components/contacts-window';
import { DebugWindow } from '@/components/debug-window';
import { DocumentsWindow } from '@/components/documents-window';
import { EmailWindow } from '@/components/email-window';
import { FilesWindow } from '@/components/files-window';
import type { WindowDimensions } from '@/components/floating-window';
import { KeychainWindow } from '@/components/keychain-window';
import { LocalStorageWindow } from '@/components/local-storage-window';
import { ModelsWindow } from '@/components/models-window';
import { NotesWindow } from '@/components/notes-window';
import { OpfsWindow } from '@/components/opfs-window';
import { PhotosWindow } from '@/components/photos-window';
import { SettingsWindow } from '@/components/settings-window';
import { SqliteWindow } from '@/components/sqlite-window';
import { TablesWindow } from '@/components/tables-window';
import { VideoWindow } from '@/components/video-window';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';

// AGENT GUARDRAIL: When adding a new window type case here, ensure parity with:
// - WindowManagerContext.tsx WindowType union
// - Home.tsx PATH_TO_WINDOW_TYPE mapping
// - Sidebar.tsx WINDOW_PATHS mapping
// Each window component should mirror its corresponding route's functionality.
export function WindowRenderer() {
  const {
    windows,
    closeWindow,
    focusWindow,
    minimizeWindow,
    saveWindowDimensionsForType,
    updateWindowDimensions
  } = useWindowManager();

  const createDimensionsHandler = useCallback(
    (type: WindowType, id: string) => (dimensions: WindowDimensions) => {
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

  const visibleWindows = windows.filter((w) => !w.isMinimized);

  if (visibleWindows.length === 0) {
    return null;
  }

  return (
    <>
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
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
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
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
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
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'files':
            return (
              <FilesWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'videos':
            return (
              <VideoWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'email':
            return (
              <EmailWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'contacts':
            return (
              <ContactsWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'photos':
            return (
              <PhotosWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'keychain':
            return (
              <KeychainWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'sqlite':
            return (
              <SqliteWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'opfs':
            return (
              <OpfsWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                initialDimensions={window.dimensions}
              />
            );
          case 'cache-storage':
            return (
              <CacheStorageWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'chat':
            return (
              <ChatWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'analytics':
            return (
              <AnalyticsWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'audio':
            return (
              <AudioWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'models':
            return (
              <ModelsWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'admin':
            return (
              <AdminWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'admin-postgres':
            return (
              <AdminPostgresWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'tables':
            return (
              <TablesWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'debug':
            return (
              <DebugWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'documents':
            return (
              <DocumentsWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                {...(window.dimensions && {
                  initialDimensions: window.dimensions
                })}
              />
            );
          case 'local-storage':
            return (
              <LocalStorageWindow
                key={window.id}
                id={window.id}
                onClose={() => closeWindow(window.id)}
                onMinimize={(dimensions) =>
                  minimizeWindow(window.id, dimensions)
                }
                onDimensionsChange={createDimensionsHandler(
                  window.type,
                  window.id
                )}
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
