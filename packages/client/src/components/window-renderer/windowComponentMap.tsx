import { lazy, type ComponentType } from 'react';
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
  import('@/components/notes-window').then((module) => ({
    default: module.NotesWindow
  }))
);
const ConsoleWindow = createDeferredWindowComponent(() =>
  import('@/components/console-window').then((module) => ({
    default: module.ConsoleWindow
  }))
);
const SettingsWindow = createDeferredWindowComponent(() =>
  import('@/components/settings-window').then((module) => ({
    default: module.SettingsWindow
  }))
);
const FilesWindow = createDeferredWindowComponent(() =>
  import('@/components/files-window').then((module) => ({
    default: module.FilesWindow
  }))
);
const VideoWindow = createDeferredWindowComponent(() =>
  import('@/components/video-window').then((module) => ({
    default: module.VideoWindow
  }))
);
const EmailWindow = createDeferredWindowComponent(() =>
  import('@/components/email-window').then((module) => ({
    default: module.EmailWindow
  }))
);
const ContactsWindow = createDeferredWindowComponent(() =>
  import('@/components/contacts-window').then((module) => ({
    default: module.ContactsWindow
  }))
);
const PhotosWindow = createDeferredWindowComponent(() =>
  import('@/components/photos-window').then((module) => ({
    default: module.PhotosWindow
  }))
);
const CameraWindow = createDeferredWindowComponent(() =>
  import('@/components/camera-window').then((module) => ({
    default: module.CameraWindow
  }))
);
const KeychainWindow = createDeferredWindowComponent(() =>
  import('@/components/keychain-window').then((module) => ({
    default: module.KeychainWindow
  }))
);
const WalletWindow = createDeferredWindowComponent(() =>
  import('@/components/wallet-window').then((module) => ({
    default: module.WalletWindow
  }))
);
const SqliteWindow = createDeferredWindowComponent(() =>
  import('@/components/sqlite-window').then((module) => ({
    default: module.SqliteWindow
  }))
);
const OpfsWindow = createDeferredWindowComponent(() =>
  import('@/components/opfs-window').then((module) => ({
    default: module.OpfsWindow
  }))
);
const CacheStorageWindow = createDeferredWindowComponent(() =>
  import('@/components/cache-storage-window').then((module) => ({
    default: module.CacheStorageWindow
  }))
);
const AIWindow = createDeferredWindowComponent(() =>
  import('@/components/ai-window').then((module) => ({
    default: module.AIWindow
  }))
);
const AnalyticsWindow = createDeferredWindowComponent(() =>
  import('@/components/analytics-window').then((module) => ({
    default: module.AnalyticsWindow
  }))
);
const AudioWindow = createDeferredWindowComponent(() =>
  import('@/components/audio-window').then((module) => ({
    default: module.AudioWindow
  }))
);
const ModelsWindow = createDeferredWindowComponent(() =>
  import('@/components/models-window').then((module) => ({
    default: module.ModelsWindow
  }))
);
const AdminWindow = createDeferredWindowComponent(() =>
  import('@/components/admin-windows').then((module) => ({
    default: module.AdminWindow
  }))
);
const AdminRedisWindow = createDeferredWindowComponent(() =>
  import('@/components/admin-redis-window').then((module) => ({
    default: module.AdminRedisWindow
  }))
);
const AdminPostgresWindow = createDeferredWindowComponent(() =>
  import('@/components/admin-postgres-window').then((module) => ({
    default: module.AdminPostgresWindow
  }))
);
const AdminGroupsWindow = createDeferredWindowComponent(() =>
  import('@/components/admin-groups-window').then((module) => ({
    default: module.AdminGroupsWindow
  }))
);
const AdminUsersWindow = createDeferredWindowComponent(() =>
  import('@/components/admin-users-window').then((module) => ({
    default: module.AdminUsersWindow
  }))
);
const AdminOrganizationsWindow = createDeferredWindowComponent(() =>
  import('@/components/admin-organizations-window').then((module) => ({
    default: module.AdminOrganizationsWindow
  }))
);
const TablesWindow = createDeferredWindowComponent(() =>
  import('@/components/tables-window').then((module) => ({
    default: module.TablesWindow
  }))
);
const DebugWindow = createDeferredWindowComponent(() =>
  import('@/components/debug-window').then((module) => ({
    default: module.DebugWindow
  }))
);
const DocumentsWindow = createDeferredWindowComponent(() =>
  import('@/components/documents-window').then((module) => ({
    default: module.DocumentsWindow
  }))
);
const HelpWindow = createDeferredWindowComponent(() =>
  import('@/components/help-window').then((module) => ({
    default: module.HelpWindow
  }))
);
const LocalStorageWindow = createDeferredWindowComponent(() =>
  import('@/components/local-storage-window').then((module) => ({
    default: module.LocalStorageWindow
  }))
);
const SyncWindow = createDeferredWindowComponent(() =>
  import('@/components/sync-window').then((module) => ({
    default: module.SyncWindow
  }))
);
const VfsWindow = createDeferredWindowComponent(() =>
  import('@/components/vfs-window').then((module) => ({
    default: module.VfsWindow
  }))
);
const ClassicWindow = createDeferredWindowComponent(() =>
  import('@/components/classic-window').then((module) => ({
    default: module.ClassicWindow
  }))
);
const BackupWindow = createDeferredWindowComponent(() =>
  import('@/components/backup-window').then((module) => ({
    default: module.BackupWindow
  }))
);
const MlsChatWindow = createDeferredWindowComponent(() =>
  import('@/components/mls-chat-window').then((module) => ({
    default: module.MlsChatWindow
  }))
);
const SearchWindow = createDeferredWindowComponent(() =>
  import('@/components/search-window').then((module) => ({
    default: module.SearchWindow
  }))
);
const CalendarWindow = createDeferredWindowComponent(() =>
  import('@/components/calendar-window').then((module) => ({
    default: module.CalendarWindow
  }))
);
const BusinessesWindow = createDeferredWindowComponent(() =>
  import('@/components/businesses-window').then((module) => ({
    default: module.BusinessesWindow
  }))
);
const VehiclesWindow = createDeferredWindowComponent(() =>
  import('@/components/vehicles-window').then((module) => ({
    default: module.VehiclesWindow
  }))
);
const HealthWindow = createDeferredWindowComponent(() =>
  import('@/components/health-window').then((module) => ({
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
