import { type ComponentType, lazy } from 'react';
import type { WindowType } from '@/contexts/WindowManagerContext';
import type {
  WindowComponentConfig,
  WindowComponentProps
} from './windowRendererTypes';

type WindowComponentModule = {
  default: ComponentType<WindowComponentProps>;
};

function createDeferredWindowComponent(
  loader: () => Promise<WindowComponentModule>
): ComponentType<WindowComponentProps> {
  const DeferredWindowComponent = lazy(loader);

  return (props: WindowComponentProps) => (
    <DeferredWindowComponent {...props} />
  );
}

const NotesWindow = createDeferredWindowComponent(() =>
  import('@/components/window-notes').then((module) => ({
    default: module.NotesWindow
  }))
);
const ConsoleWindow = createDeferredWindowComponent(() =>
  import('@/components/window-console').then((module) => ({
    default: module.ConsoleWindow
  }))
);
const SettingsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-settings').then((module) => ({
    default: module.SettingsWindow
  }))
);
const FilesWindow = createDeferredWindowComponent(() =>
  import('@/components/window-files').then((module) => ({
    default: module.FilesWindow
  }))
);
const VideoWindow = createDeferredWindowComponent(() =>
  import('@/components/window-video').then((module) => ({
    default: module.VideoWindow
  }))
);
const EmailWindow = createDeferredWindowComponent(() =>
  import('@/components/window-email').then((module) => ({
    default: module.EmailWindow
  }))
);
const ContactsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-contacts').then((module) => ({
    default: module.ContactsWindow
  }))
);
const PhotosWindow = createDeferredWindowComponent(() =>
  import('@/components/window-photos').then((module) => ({
    default: module.PhotosWindow
  }))
);
const CameraWindow = createDeferredWindowComponent(() =>
  import('@/components/window-camera').then((module) => ({
    default: module.CameraWindow
  }))
);
const KeychainWindow = createDeferredWindowComponent(() =>
  import('@/components/window-keychain').then((module) => ({
    default: module.KeychainWindow
  }))
);
const WalletWindow = createDeferredWindowComponent(() =>
  import('@/components/window-wallet').then((module) => ({
    default: module.WalletWindow
  }))
);
const SqliteWindow = createDeferredWindowComponent(() =>
  import('@/components/window-sqlite').then((module) => ({
    default: module.SqliteWindow
  }))
);
const OpfsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-opfs').then((module) => ({
    default: module.OpfsWindow
  }))
);
const CacheStorageWindow = createDeferredWindowComponent(() =>
  import('@/components/window-cache-storage').then((module) => ({
    default: module.CacheStorageWindow
  }))
);
const AIWindow = createDeferredWindowComponent(() =>
  import('@/components/window-ai').then((module) => ({
    default: module.AIWindow
  }))
);
const AnalyticsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-analytics').then((module) => ({
    default: module.AnalyticsWindow
  }))
);
const AudioWindow = createDeferredWindowComponent(() =>
  import('@/components/window-audio').then((module) => ({
    default: module.AudioWindow
  }))
);
const ModelsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-models').then((module) => ({
    default: module.ModelsWindow
  }))
);
const AdminWindow = createDeferredWindowComponent(() =>
  import('@/components/admin-windows').then((module) => ({
    default: module.AdminWindow
  }))
);
const AdminRedisWindow = createDeferredWindowComponent(() =>
  import('@/components/window-admin-redis').then((module) => ({
    default: module.AdminRedisWindow
  }))
);
const AdminPostgresWindow = createDeferredWindowComponent(() =>
  import('@/components/window-admin-postgres').then((module) => ({
    default: module.AdminPostgresWindow
  }))
);
const AdminGroupsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-admin-groups').then((module) => ({
    default: module.AdminGroupsWindow
  }))
);
const AdminUsersWindow = createDeferredWindowComponent(() =>
  import('@/components/window-admin-users').then((module) => ({
    default: module.AdminUsersWindow
  }))
);
const AdminOrganizationsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-admin-organizations').then((module) => ({
    default: module.AdminOrganizationsWindow
  }))
);
const TablesWindow = createDeferredWindowComponent(() =>
  import('@/components/window-tables').then((module) => ({
    default: module.TablesWindow
  }))
);
const DebugWindow = createDeferredWindowComponent(() =>
  import('@/components/window-debug').then((module) => ({
    default: module.DebugWindow
  }))
);
const DocumentsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-documents').then((module) => ({
    default: module.DocumentsWindow
  }))
);
const HelpWindow = createDeferredWindowComponent(() =>
  import('@/components/window-help').then((module) => ({
    default: module.HelpWindow
  }))
);
const LocalStorageWindow = createDeferredWindowComponent(() =>
  import('@/components/window-local-storage').then((module) => ({
    default: module.LocalStorageWindow
  }))
);
const SyncWindow = createDeferredWindowComponent(() =>
  import('@/components/window-sync').then((module) => ({
    default: module.SyncWindow
  }))
);
const VfsWindow = createDeferredWindowComponent(() =>
  import('@/components/window-vfs').then((module) => ({
    default: module.VfsWindow
  }))
);
const ClassicWindow = createDeferredWindowComponent(() =>
  import('@/components/window-classic').then((module) => ({
    default: module.ClassicWindow
  }))
);
const BackupWindow = createDeferredWindowComponent(() =>
  import('@/components/window-backup').then((module) => ({
    default: module.BackupWindow
  }))
);
const MlsChatWindow = createDeferredWindowComponent(() =>
  import('@/components/window-mls-chat').then((module) => ({
    default: module.MlsChatWindow
  }))
);
const SearchWindow = createDeferredWindowComponent(() =>
  import('@/components/window-search').then((module) => ({
    default: module.SearchWindow
  }))
);
const CalendarWindow = createDeferredWindowComponent(() =>
  import('@/components/window-calendar').then((module) => ({
    default: module.CalendarWindow
  }))
);
const BusinessesWindow = createDeferredWindowComponent(() =>
  import('@/components/window-businesses').then((module) => ({
    default: module.BusinessesWindow
  }))
);
const VehiclesWindow = createDeferredWindowComponent(() =>
  import('@/components/window-vehicles').then((module) => ({
    default: module.VehiclesWindow
  }))
);
const HealthWindow = createDeferredWindowComponent(() =>
  import('@/components/window-health').then((module) => ({
    default: module.HealthWindow
  }))
);
const NotificationCenter = createDeferredWindowComponent(() =>
  import('@/components/notification-center').then((module) => ({
    default: module.NotificationCenter
  }))
);

export const windowComponentMap: Record<WindowType, WindowComponentConfig> = {
  // AGENT GUARDRAIL: keep parity with WindowType, home mapping, and sidebar paths.
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
