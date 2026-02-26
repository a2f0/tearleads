import { Route, Routes } from 'react-router-dom';
import App from './app/App';
import { RequireAuth } from './components/auth';
import {
  Admin,
  AdminLauncher,
  AiRequestsAdminPage,
  Analytics,
  ApiDocsPage,
  AudioDetail,
  AudioPage,
  Backups,
  Businesses,
  CacheStorage,
  Calendar,
  CameraPage,
  Chat,
  Classic,
  Compliance,
  ComplianceDocPage,
  Console,
  ContactDetail,
  ContactNew,
  Contacts,
  DebugBrowserLauncher,
  DebugLauncher,
  DebugSystemInfo,
  DocumentDetail,
  Documents,
  Email,
  Files,
  GroupDetailPageRoute,
  GroupsAdminPage,
  Health,
  Help,
  HelpDocPage,
  Home,
  Keychain,
  KeychainDetail,
  Licenses,
  LocalStorage,
  MlsChat,
  Models,
  NoteDetail,
  Notes,
  Opfs,
  OrganizationDetailPageRoute,
  OrganizationsAdminPage,
  PhotoDetail,
  Photos,
  PostgresAdmin,
  Search,
  Settings,
  Sqlite,
  Sync,
  TableRows,
  Tables,
  UsersAdminDetail,
  UsersAdminPage,
  Vehicles,
  Vfs,
  VideoDetail,
  VideoPage,
  Wallet,
  WalletDetail,
  WalletNewItem
} from './lazyPages';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<App />}>
        <Route index element={<Home />} />
        <Route path="search" element={<Search />} />
        <Route path="files" element={<Files />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="businesses" element={<Businesses />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="health" element={<Health />} />
        <Route path="health/height" element={<Health />} />
        <Route path="health/weight" element={<Health />} />
        <Route path="health/workouts" element={<Health />} />
        <Route path="health/blood-pressure" element={<Health />} />
        <Route path="contacts/new" element={<ContactNew />} />
        <Route path="contacts/groups/:groupId" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactDetail />} />
        <Route path="documents" element={<Documents />} />
        <Route path="documents/:id" element={<DocumentDetail />} />
        <Route path="notes" element={<Notes />} />
        <Route path="notes/:id" element={<NoteDetail />} />
        <Route path="photos" element={<Photos />} />
        <Route path="camera" element={<CameraPage />} />
        <Route path="photos/albums/:albumId" element={<Photos />} />
        <Route path="photos/:id" element={<PhotoDetail />} />
        <Route path="audio" element={<AudioPage />} />
        <Route path="audio/playlists/:playlistId" element={<AudioPage />} />
        <Route path="audio/:id" element={<AudioDetail />} />
        <Route path="videos" element={<VideoPage />} />
        <Route path="videos/playlists/:playlistId" element={<VideoPage />} />
        <Route path="videos/:id" element={<VideoDetail />} />
        <Route path="sqlite" element={<Sqlite />} />
        <Route path="console" element={<Console />} />
        <Route path="debug" element={<DebugLauncher />} />
        <Route
          path="debug/system-info"
          element={
            <DebugSystemInfo
              showBackLink
              backTo="/debug"
              backLabel="Back to Debug"
            />
          }
        />
        <Route path="debug/browser" element={<DebugBrowserLauncher />} />
        <Route
          path="debug/browser/local-storage"
          element={
            <LocalStorage backTo="/debug/browser" backLabel="Back to Browser" />
          }
        />
        <Route
          path="debug/browser/opfs"
          element={
            <Opfs
              showBackLink
              backTo="/debug/browser"
              backLabel="Back to Browser"
            />
          }
        />
        <Route
          path="debug/browser/cache-storage"
          element={
            <CacheStorage backTo="/debug/browser" backLabel="Back to Browser" />
          }
        />
        <Route path="help" element={<Help />} />
        <Route path="help/api" element={<ApiDocsPage />} />
        <Route path="help/docs/:docId" element={<HelpDocPage />} />
        <Route path="compliance" element={<Compliance />} />
        <Route path="compliance/:framework/*" element={<ComplianceDocPage />} />
        <Route
          path="ai"
          element={
            <RequireAuth
              loginTitle="AI Requires Login"
              loginDescription="Sign in to access AI features"
            >
              <Chat />
            </RequireAuth>
          }
        />
        <Route
          path="email"
          element={
            <RequireAuth
              loginTitle="Email Requires Login"
              loginDescription="Sign in to access your email"
            >
              <Email />
            </RequireAuth>
          }
        />
        <Route
          path="mls-chat"
          element={
            <RequireAuth
              loginTitle="MLS Chat Requires Login"
              loginDescription="Sign in to access encrypted chat"
            >
              <MlsChat />
            </RequireAuth>
          }
        />
        <Route path="models" element={<Models />} />
        <Route path="settings" element={<Settings />} />
        <Route path="licenses" element={<Licenses />} />
        <Route path="sqlite/tables" element={<Tables />} />
        <Route path="sqlite/tables/:tableName" element={<TableRows />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="keychain" element={<Keychain />} />
        <Route path="keychain/:id" element={<KeychainDetail />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="wallet/new" element={<WalletNewItem />} />
        <Route path="wallet/new/:itemType" element={<WalletDetail />} />
        <Route path="wallet/:id" element={<WalletDetail />} />
        <Route path="admin" element={<AdminLauncher />} />
        <Route path="admin/redis" element={<Admin />} />
        <Route path="admin/postgres" element={<PostgresAdmin />} />
        <Route path="admin/groups" element={<GroupsAdminPage />} />
        <Route path="admin/groups/:id" element={<GroupDetailPageRoute />} />
        <Route
          path="admin/organizations"
          element={<OrganizationsAdminPage />}
        />
        <Route
          path="admin/organizations/:id"
          element={<OrganizationDetailPageRoute />}
        />
        <Route path="admin/users" element={<UsersAdminPage />} />
        <Route
          path="admin/users/ai-requests"
          element={<AiRequestsAdminPage />}
        />
        <Route path="admin/users/:id" element={<UsersAdminDetail />} />
        <Route path="sync" element={<Sync />} />
        <Route path="vfs" element={<Vfs />} />
        <Route path="classic" element={<Classic />} />
        <Route path="backups" element={<Backups />} />
      </Route>
    </Routes>
  );
}
