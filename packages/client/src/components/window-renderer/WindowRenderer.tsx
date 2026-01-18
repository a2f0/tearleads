import { type ComponentType, useCallback } from 'react';
import { AdminWindow } from '@/components/admin-window';
import { AnalyticsWindow } from '@/components/analytics-window';
import { AudioWindow } from '@/components/audio-window';
import { CacheStorageWindow } from '@/components/cache-storage-window';
import { ChatWindow } from '@/components/chat-window';
import { ConsoleWindow } from '@/components/console-window';
import { ContactsWindow } from '@/components/contacts-window';
import { DebugWindow } from '@/components/debug-window';
import { EmailWindow } from '@/components/email-window';
import { FilesWindow } from '@/components/files-window';
import type { WindowDimensions } from '@/components/floating-window';
import { KeychainWindow } from '@/components/keychain-window';
import { NotesWindow } from '@/components/notes-window';
import { PhotosWindow } from '@/components/photos-window';
import { SettingsWindow } from '@/components/settings-window';
import { SqliteWindow } from '@/components/sqlite-window';
import { VideoWindow } from '@/components/video-window';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';

type WindowComponentProps = {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
};

const WINDOW_COMPONENTS: Record<
  WindowType,
  ComponentType<WindowComponentProps>
> = {
  notes: NotesWindow,
  console: ConsoleWindow,
  settings: SettingsWindow,
  files: FilesWindow,
  debug: DebugWindow,
  email: EmailWindow,
  contacts: ContactsWindow,
  photos: PhotosWindow,
  videos: VideoWindow,
  keychain: KeychainWindow,
  sqlite: SqliteWindow,
  chat: ChatWindow,
  analytics: AnalyticsWindow,
  audio: AudioWindow,
  admin: AdminWindow,
  'cache-storage': CacheStorageWindow
};

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
        const WindowComponent = WINDOW_COMPONENTS[window.type];
        if (!WindowComponent) {
          return null;
        }
        return (
          <WindowComponent
            key={window.id}
            id={window.id}
            onClose={() => closeWindow(window.id)}
            onMinimize={(dimensions) => minimizeWindow(window.id, dimensions)}
            onDimensionsChange={createDimensionsHandler(window.type)}
            onFocus={() => focusWindow(window.id)}
            zIndex={window.zIndex}
            {...(window.dimensions && {
              initialDimensions: window.dimensions
            })}
          />
        );
      })}
    </>
  );
}
