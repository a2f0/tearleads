import type { ComponentType } from 'react';
import { useCallback } from 'react';
import { AdminPostgresWindow } from '@/components/admin-postgres-window';
import { AdminWindow } from '@/components/admin-window';
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
import { HelpWindow } from '@/components/help-window';
import { KeychainWindow } from '@/components/keychain-window';
import { LocalStorageWindow } from '@/components/local-storage-window';
import { ModelsWindow } from '@/components/models-window';
import { NotesWindow } from '@/components/notes-window';
import { OpfsWindow } from '@/components/opfs-window';
import { PhotosWindow } from '@/components/photos-window';
import { SettingsWindow } from '@/components/settings-window';
import { SqliteWindow } from '@/components/sqlite-window';
import { SyncWindow } from '@/components/sync-window';
import { TablesWindow } from '@/components/tables-window';
import { VideoWindow } from '@/components/video-window';
import type {
  WindowInstance,
  WindowType
} from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';

// AGENT GUARDRAIL: When adding a new window type entry here, ensure parity with:
// - WindowManagerContext.tsx WindowType union
// - Home.tsx PATH_TO_WINDOW_TYPE mapping
// - Sidebar.tsx WINDOW_PATHS mapping
// Each window component should mirror its corresponding route's functionality.
interface WindowComponentProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

interface WindowComponentConfig {
  Component: ComponentType<WindowComponentProps>;
  getInitialDimensions?: (
    window: WindowInstance
  ) => WindowDimensions | undefined;
}

const defaultInitialDimensions = (window: WindowInstance) => window.dimensions;

const windowComponentMap: Record<WindowType, WindowComponentConfig> = {
  notes: { Component: NotesWindow },
  console: { Component: ConsoleWindow },
  settings: { Component: SettingsWindow },
  files: { Component: FilesWindow },
  videos: { Component: VideoWindow },
  email: { Component: EmailWindow },
  contacts: { Component: ContactsWindow },
  photos: { Component: PhotosWindow },
  keychain: { Component: KeychainWindow },
  sqlite: { Component: SqliteWindow },
  opfs: { Component: OpfsWindow },
  'cache-storage': { Component: CacheStorageWindow },
  chat: { Component: ChatWindow },
  analytics: { Component: AnalyticsWindow },
  audio: { Component: AudioWindow },
  models: { Component: ModelsWindow },
  admin: { Component: AdminWindow },
  'admin-postgres': { Component: AdminPostgresWindow },
  tables: { Component: TablesWindow },
  debug: { Component: DebugWindow },
  documents: { Component: DocumentsWindow },
  help: { Component: HelpWindow },
  'local-storage': { Component: LocalStorageWindow },
  sync: { Component: SyncWindow }
};

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
        const windowConfig = windowComponentMap[window.type];
        if (!windowConfig) {
          return null;
        }

        const WindowComponent = windowConfig.Component;
        const resolvedInitialDimensions =
          windowConfig.getInitialDimensions?.(window) ??
          defaultInitialDimensions(window);

        return (
          <WindowComponent
            key={window.id}
            id={window.id}
            onClose={() => closeWindow(window.id)}
            onMinimize={(dimensions) => minimizeWindow(window.id, dimensions)}
            onDimensionsChange={createDimensionsHandler(window.type, window.id)}
            onFocus={() => focusWindow(window.id)}
            zIndex={window.zIndex}
            {...(resolvedInitialDimensions && {
              initialDimensions: resolvedInitialDimensions
            })}
          />
        );
      })}
    </>
  );
}
