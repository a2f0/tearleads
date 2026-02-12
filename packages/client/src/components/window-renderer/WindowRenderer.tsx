import { KeychainWindow } from '@tearleads/keychain';
import type { ComponentType } from 'react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { AdminGroupsWindow } from '@/components/admin-groups-window';
import { AdminOrganizationsWindow } from '@/components/admin-organizations-window';
import { AdminPostgresWindow } from '@/components/admin-postgres-window';
import { AdminRedisWindow } from '@/components/admin-redis-window';
import { AdminUsersWindow } from '@/components/admin-users-window';
import { AdminWindow } from '@/components/admin-window';
import { AnalyticsWindow } from '@/components/analytics-window';
import { AudioWindow } from '@/components/audio-window';
import { BackupWindow } from '@/components/backup-window';
import { CacheStorageWindow } from '@/components/cache-storage-window';
import { CalendarWindow } from '@/components/calendar-window';
import { ChatWindow } from '@/components/chat-window';
import { ClassicWindow } from '@/components/classic-window';
import { ConsoleWindow } from '@/components/console-window';
import { ContactsWindow } from '@/components/contacts-window';
import { DebugWindow } from '@/components/debug-window';
import { DocumentsWindow } from '@/components/documents-window';
import { EmailWindow } from '@/components/email-window';
import { FilesWindow } from '@/components/files-window';
import type { WindowDimensions } from '@/components/floating-window';
import { HelpWindow } from '@/components/help-window';
import { LocalStorageWindow } from '@/components/local-storage-window';
import { MlsChatWindow } from '@/components/mls-chat-window';
import { ModelsWindow } from '@/components/models-window';
import { NotesWindow } from '@/components/notes-window';
import { NotificationCenter } from '@/components/notification-center';
import { OpfsWindow } from '@/components/opfs-window';
import { PhotosWindow } from '@/components/photos-window';
import { SearchWindow } from '@/components/search-window';
import { SettingsWindow } from '@/components/settings-window';
import { SqliteWindow } from '@/components/sqlite-window';
import { SyncWindow } from '@/components/sync-window';
import { TablesWindow } from '@/components/tables-window';
import { VfsWindow } from '@/components/vfs-window';
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

interface MemoizedWindowProps {
  window: WindowInstance;
  config: WindowComponentConfig;
  onClose: (id: string) => void;
  onMinimize: (id: string, dimensions: WindowDimensions) => void;
  onDimensionsChange: (
    type: WindowType,
    id: string,
    dimensions: WindowDimensions
  ) => void;
  onFocus: (id: string) => void;
}

const MemoizedWindow = memo(function MemoizedWindow({
  window,
  config,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus
}: MemoizedWindowProps) {
  const WindowComponent = config.Component;
  const resolvedInitialDimensions =
    config.getInitialDimensions?.(window) ?? defaultInitialDimensions(window);

  const handleClose = useCallback(
    () => onClose(window.id),
    [onClose, window.id]
  );
  const handleMinimize = useCallback(
    (dimensions: WindowDimensions) => onMinimize(window.id, dimensions),
    [onMinimize, window.id]
  );
  const handleDimensionsChange = useCallback(
    (dimensions: WindowDimensions) =>
      onDimensionsChange(window.type, window.id, dimensions),
    [onDimensionsChange, window.type, window.id]
  );
  const handleFocus = useCallback(
    () => onFocus(window.id),
    [onFocus, window.id]
  );

  return (
    <WindowComponent
      id={window.id}
      onClose={handleClose}
      onMinimize={handleMinimize}
      onDimensionsChange={handleDimensionsChange}
      onFocus={handleFocus}
      zIndex={window.zIndex}
      {...(resolvedInitialDimensions && {
        initialDimensions: resolvedInitialDimensions
      })}
    />
  );
});

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
  'admin-redis': { Component: AdminRedisWindow },
  'admin-postgres': { Component: AdminPostgresWindow },
  'admin-groups': { Component: AdminGroupsWindow },
  'admin-users': { Component: AdminUsersWindow },
  'admin-organizations': { Component: AdminOrganizationsWindow },
  tables: { Component: TablesWindow },
  debug: { Component: DebugWindow },
  documents: { Component: DocumentsWindow },
  help: { Component: HelpWindow },
  'local-storage': { Component: LocalStorageWindow },
  sync: { Component: SyncWindow },
  vfs: { Component: VfsWindow },
  classic: { Component: ClassicWindow },
  backup: { Component: BackupWindow },
  'mls-chat': { Component: MlsChatWindow },
  search: { Component: SearchWindow },
  calendar: { Component: CalendarWindow },
  'notification-center': { Component: NotificationCenter }
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
          <MemoizedWindow
            key={window.id}
            window={window}
            config={windowConfig}
            onClose={closeWindow}
            onMinimize={minimizeWindow}
            onDimensionsChange={handleDimensionsChange}
            onFocus={handleFocusWindow}
          />
        );
      })}
    </>
  );
}
