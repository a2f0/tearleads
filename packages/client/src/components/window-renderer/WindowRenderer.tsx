import { useCallback } from 'react';
import { AdminWindow } from '@/components/admin-window';
import { AnalyticsWindow } from '@/components/analytics-window';
import { AudioWindow } from '@/components/audio-window';
import { CacheStorageWindow } from '@/components/cache-storage-window';
import { ChatWindow } from '@/components/chat-window';
import { ConsoleWindow } from '@/components/console-window';
import { ContactsWindow } from '@/components/contacts-window';
import { EmailWindow } from '@/components/email-window';
import { FilesWindow } from '@/components/files-window';
import type { WindowDimensions } from '@/components/floating-window';
import { KeychainWindow } from '@/components/keychain-window';
import { ModelsWindow } from '@/components/models-window';
import { NotesWindow } from '@/components/notes-window';
import { OpfsWindow } from '@/components/opfs-window';
import { PhotosWindow } from '@/components/photos-window';
import { SettingsWindow } from '@/components/settings-window';
import { SqliteWindow } from '@/components/sqlite-window';
import { VideoWindow } from '@/components/video-window';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';

export function WindowRenderer() {
  const {
    windows,
    closeWindow,
    focusWindow,
    minimizeWindow,
    saveWindowDimensionsForType
  } = useWindowManager();

  const createDimensionsHandler = useCallback(
    (type: WindowType) => (dimensions: WindowDimensions) => {
      saveWindowDimensionsForType(type, dimensions);
    },
    [saveWindowDimensionsForType]
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
                onDimensionsChange={createDimensionsHandler('notes')}
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
                onDimensionsChange={createDimensionsHandler('console')}
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
                onDimensionsChange={createDimensionsHandler('settings')}
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
                onDimensionsChange={createDimensionsHandler('files')}
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
                onDimensionsChange={createDimensionsHandler('email')}
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
                onDimensionsChange={createDimensionsHandler('contacts')}
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
                onDimensionsChange={createDimensionsHandler('photos')}
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
                onDimensionsChange={createDimensionsHandler('keychain')}
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
                onDimensionsChange={createDimensionsHandler('sqlite')}
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
                onDimensionsChange={createDimensionsHandler('videos')}
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
                onDimensionsChange={createDimensionsHandler('opfs')}
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
                onDimensionsChange={createDimensionsHandler('cache-storage')}
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
                onDimensionsChange={createDimensionsHandler('chat')}
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
                onDimensionsChange={createDimensionsHandler('analytics')}
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
                onDimensionsChange={createDimensionsHandler('audio')}
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
                onDimensionsChange={createDimensionsHandler('models')}
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
                onDimensionsChange={createDimensionsHandler('admin')}
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
                onDimensionsChange={createDimensionsHandler('local-storage')}
                onFocus={() => focusWindow(window.id)}
                zIndex={window.zIndex}
                initialDimensions={window.dimensions}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
