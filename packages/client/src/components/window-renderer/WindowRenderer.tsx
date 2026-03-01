import type { WindowDimensions } from '@tearleads/window-manager';
import { useCallback, useMemo, useRef } from 'react';
import { AdminOrganizationsWindow } from '@/components/admin-organizations-window';
import { AdminUsersWindow } from '@/components/admin-users-window';
import { AnalyticsWindow } from '@/components/analytics-window';
import {
  AdminGroupsWindow,
  AdminPostgresWindow,
  AdminRedisWindow,
  AdminWindow
} from '@/components/admin-windows';
import { AIWindow } from '@/components/ai-window';
import { AudioWindow } from '@/components/audio-window';
import { BackupWindow } from '@/components/backup-window';
import { BusinessesWindow } from '@/components/businesses-window';
import { CacheStorageWindow } from '@/components/cache-storage-window';
import { CalendarWindow } from '@/components/calendar-window';
import { CameraWindow } from '@/components/camera-window';
import { ClassicWindow } from '@/components/classic-window';
import { ConsoleWindow } from '@/components/console-window';
import { ContactsWindow } from '@/components/contacts-window';
import { DebugWindow } from '@/components/debug-window';
import { DocumentsWindow } from '@/components/documents-window';
import { EmailWindow } from '@/components/email-window';
import { FilesWindow } from '@/components/files-window';
import { HealthWindow } from '@/components/health-window';
import { HelpWindow } from '@/components/help-window';
import { KeychainWindow } from '@/components/keychain-window';
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
import { VehiclesWindow } from '@/components/vehicles-window';
import { VfsWindow } from '@/components/vfs-window';
import { VideoWindow } from '@/components/video-window';
import { WalletWindow } from '@/components/wallet-window';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { MemoizedWindow } from './MemoizedWindow';
import type { WindowComponentConfig } from './windowRendererTypes';

// AGENT GUARDRAIL: When adding a new window type entry here, ensure parity with:
// - WindowManagerContext.tsx WindowType union
// - Home.tsx PATH_TO_WINDOW_TYPE mapping
// - Sidebar.tsx WINDOW_PATHS mapping
// Each window component should mirror its corresponding route's functionality.
const windowComponentMap: Record<WindowType, WindowComponentConfig> = {
  notes: { Component: NotesWindow },
  console: { Component: ConsoleWindow },
  settings: { Component: SettingsWindow },
  files: { Component: FilesWindow },
  videos: { Component: VideoWindow },
  email: { Component: EmailWindow },
  contacts: { Component: ContactsWindow },
  photos: { Component: PhotosWindow },
  camera: { Component: CameraWindow },
  keychain: { Component: KeychainWindow },
  wallet: { Component: WalletWindow },
  sqlite: { Component: SqliteWindow },
  opfs: { Component: OpfsWindow },
  'cache-storage': { Component: CacheStorageWindow },
  ai: { Component: AIWindow },
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
  businesses: { Component: BusinessesWindow },
  vehicles: { Component: VehiclesWindow },
  health: { Component: HealthWindow },
  'notification-center': { Component: NotificationCenter }
};

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
          <MemoizedWindow
            key={window.id}
            window={window}
            config={windowConfig}
            onClose={closeWindow}
            onMinimize={minimizeWindow}
            onDimensionsChange={handleDimensionsChange}
            onRename={renameWindow}
            onFocus={handleFocusWindow}
          />
        );
      })}
    </>
  );
}
