import { ThemeProvider } from '@tearleads/ui';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { AudioProvider } from './audio';
import { AppTooltipProvider } from './components/AppTooltipProvider';
import { AndroidMediaSessionBridge } from './components/audio/AndroidMediaSessionBridge';
import { RequireAuth } from './components/auth';
import { GlobalSettingsEffects } from './components/GlobalSettingsEffects';
import { InstanceChangeHandler } from './components/InstanceChangeHandler';
import {
  LaserScreensaver,
  ScreensaverProvider
} from './components/screensaver';
import {
  ErrorBoundary,
  errorBoundaryRef
} from './components/ui/error-boundary';
import { WindowRenderer } from './components/window-renderer';
import { AuthProvider } from './contexts/AuthContext';
import { WindowManagerProvider } from './contexts/WindowManagerContext';
import { DatabaseProvider, SettingsProvider } from './db/hooks';
import { i18n } from './i18n';
import { installConsoleErrorCapture } from './lib/console-error-capture';
import { SearchProvider } from './search';
import { SSEProvider } from './sse';
import { VideoProvider } from './video';
import './index.css';

// Check for service worker updates when tab gains focus
if ('serviceWorker' in navigator) {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
      } catch {
        // Ignore update errors (e.g., offline, SW disabled)
      }
    }
  });
}

// Lazy-loaded pages for code splitting
const Admin = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.Admin }))
);
const AdminLauncher = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.AdminLauncher }))
);
const AiRequestsAdminPage = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.AiRequestsAdminPage }))
);
const PostgresAdmin = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.PostgresAdmin }))
);
const GroupsAdminPage = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.GroupsAdminPage }))
);
const GroupDetailPageRoute = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.GroupDetailPageRoute }))
);
const OrganizationsAdminPage = lazy(() =>
  import('@tearleads/admin').then((m) => ({
    default: m.OrganizationsAdminPage
  }))
);
const OrganizationDetailPageRoute = lazy(() =>
  import('@tearleads/admin').then((m) => ({
    default: m.OrganizationDetailPageRoute
  }))
);
const UsersAdminPage = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.UsersAdminPage }))
);
const UsersAdminDetail = lazy(() =>
  import('@tearleads/admin').then((m) => ({ default: m.UsersAdminDetail }))
);
const Analytics = lazy(() =>
  import('./pages/analytics').then((m) => ({ default: m.Analytics }))
);
const AudioDetail = lazy(() =>
  import('./pages/AudioDetail').then((m) => ({ default: m.AudioDetail }))
);
const AudioPage = lazy(() =>
  import('./pages/Audio').then((m) => ({ default: m.Audio }))
);
const Backups = lazy(() =>
  import('./pages/Backups').then((m) => ({ default: m.Backups }))
);
const Classic = lazy(() =>
  import('./pages/Classic').then((m) => ({ default: m.Classic }))
);
const CacheStorage = lazy(() =>
  import('./pages/cache-storage').then((m) => ({ default: m.CacheStorage }))
);
const Calendar = lazy(() =>
  import('./pages/Calendar').then((m) => ({ default: m.Calendar }))
);
const CameraPage = lazy(() =>
  import('./pages/Camera').then((m) => ({ default: m.Camera }))
);
const Businesses = lazy(() =>
  import('./pages/Businesses').then((m) => ({ default: m.Businesses }))
);
const Chat = lazy(() =>
  import('./pages/chat').then((m) => ({ default: m.Chat }))
);
const ContactDetail = lazy(() =>
  import('./pages/ContactDetail').then((m) => ({ default: m.ContactDetail }))
);
const Console = lazy(() =>
  import('@tearleads/console').then((m) => ({ default: m.Console }))
);
const ContactNew = lazy(() =>
  import('./pages/ContactNew').then((m) => ({ default: m.ContactNew }))
);
const Contacts = lazy(() =>
  import('./pages/contacts').then((m) => ({ default: m.Contacts }))
);
const Debug = lazy(() =>
  import('./pages/debug').then((m) => ({ default: m.Debug }))
);
const ApiDocsPage = lazy(() =>
  import('./pages/help/ApiDocs').then((m) => ({ default: m.ApiDocsPage }))
);
const HelpDocPage = lazy(() =>
  import('./pages/help/HelpDoc').then((m) => ({ default: m.HelpDocPage }))
);
const Help = lazy(() =>
  import('./pages/help/Help').then((m) => ({ default: m.Help }))
);
const Compliance = lazy(() =>
  import('./pages/compliance/Compliance').then((m) => ({
    default: m.Compliance
  }))
);
const ComplianceDocPage = lazy(() =>
  import('./pages/compliance/ComplianceDoc').then((m) => ({
    default: m.ComplianceDocPage
  }))
);
const DocumentDetail = lazy(() =>
  import('./pages/DocumentDetail').then((m) => ({ default: m.DocumentDetail }))
);
const Documents = lazy(() =>
  import('./pages/Documents').then((m) => ({ default: m.Documents }))
);
const Email = lazy(() =>
  import('./pages/Email').then((m) => ({ default: m.Email }))
);
const MlsChat = lazy(() =>
  import('./pages/MlsChat').then((m) => ({ default: m.MlsChat }))
);
const Files = lazy(() =>
  import('./pages/Files').then((m) => ({ default: m.Files }))
);
const Home = lazy(() =>
  import('./pages/Home').then((m) => ({ default: m.Home }))
);
const Keychain = lazy(() =>
  import('@tearleads/keychain').then((m) => ({ default: m.Keychain }))
);
const KeychainDetail = lazy(() =>
  import('@tearleads/keychain').then((m) => ({ default: m.KeychainDetail }))
);
const Wallet = lazy(() =>
  import('@tearleads/wallet').then((m) => ({ default: m.Wallet }))
);
const WalletDetail = lazy(() =>
  import('@tearleads/wallet').then((m) => ({ default: m.WalletDetail }))
);
const Licenses = lazy(() =>
  import('./pages/Licenses').then((m) => ({ default: m.Licenses }))
);
const LocalStorage = lazy(() =>
  import('./pages/local-storage').then((m) => ({ default: m.LocalStorage }))
);
const Models = lazy(() =>
  import('./pages/models').then((m) => ({ default: m.Models }))
);
const NoteDetail = lazy(() =>
  import('./pages/NoteDetail').then((m) => ({ default: m.NoteDetail }))
);
const Notes = lazy(() =>
  import('./pages/Notes').then((m) => ({ default: m.Notes }))
);
const Opfs = lazy(() =>
  import('./pages/opfs').then((m) => ({ default: m.Opfs }))
);
const PhotoDetail = lazy(() =>
  import('./pages/PhotoDetail').then((m) => ({ default: m.PhotoDetail }))
);
const Photos = lazy(() =>
  import('./pages/Photos').then((m) => ({ default: m.PhotosPage }))
);
const Search = lazy(() =>
  import('./pages/search').then((m) => ({ default: m.Search }))
);
const Settings = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.Settings }))
);
const Sync = lazy(() =>
  import('@tearleads/sync').then((m) => ({ default: m.Sync }))
);
const Sqlite = lazy(() =>
  import('./pages/Sqlite').then((m) => ({ default: m.Sqlite }))
);
const TableRows = lazy(() =>
  import('./pages/TableRows').then((m) => ({ default: m.TableRows }))
);
const Tables = lazy(() =>
  import('./pages/Tables').then((m) => ({ default: m.Tables }))
);
const VideoDetail = lazy(() =>
  import('./pages/VideoDetail').then((m) => ({ default: m.VideoDetail }))
);
const Vfs = lazy(() => import('./pages/Vfs').then((m) => ({ default: m.Vfs })));
const VideoPage = lazy(() =>
  import('./pages/Video').then((m) => ({ default: m.Video }))
);

// Global error handlers for async errors (not caught by React error boundaries)
window.addEventListener(
  'unhandledrejection',
  (event: PromiseRejectionEvent) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
    errorBoundaryRef.current?.setError(error);
  }
);

window.addEventListener('error', (event: ErrorEvent) => {
  // Only handle errors that aren't already caught by React
  if (event.error) {
    errorBoundaryRef.current?.setError(event.error);
  }
});

installConsoleErrorCapture();

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <ScreensaverProvider>
              <Toaster richColors closeButton position="top-center" />
              <DatabaseProvider>
                <SettingsProvider>
                  <GlobalSettingsEffects />
                  <SearchProvider>
                    <AppTooltipProvider>
                      <InstanceChangeHandler />
                      <AudioProvider>
                        <AndroidMediaSessionBridge />
                        <VideoProvider>
                          <AuthProvider>
                            <SSEProvider>
                              <WindowManagerProvider>
                                <BrowserRouter>
                                  <Suspense
                                    fallback={
                                      <div className="p-8 text-center text-muted-foreground">
                                        Loading...
                                      </div>
                                    }
                                  >
                                    <Routes>
                                      <Route path="/" element={<App />}>
                                        <Route index element={<Home />} />
                                        <Route
                                          path="search"
                                          element={<Search />}
                                        />
                                        <Route
                                          path="files"
                                          element={<Files />}
                                        />
                                        <Route
                                          path="contacts"
                                          element={<Contacts />}
                                        />
                                        <Route
                                          path="calendar"
                                          element={<Calendar />}
                                        />
                                        <Route
                                          path="businesses"
                                          element={<Businesses />}
                                        />
                                        <Route
                                          path="contacts/new"
                                          element={<ContactNew />}
                                        />
                                        <Route
                                          path="contacts/groups/:groupId"
                                          element={<Contacts />}
                                        />
                                        <Route
                                          path="contacts/:id"
                                          element={<ContactDetail />}
                                        />
                                        <Route
                                          path="documents"
                                          element={<Documents />}
                                        />
                                        <Route
                                          path="documents/:id"
                                          element={<DocumentDetail />}
                                        />
                                        <Route
                                          path="notes"
                                          element={<Notes />}
                                        />
                                        <Route
                                          path="notes/:id"
                                          element={<NoteDetail />}
                                        />
                                        <Route
                                          path="photos"
                                          element={<Photos />}
                                        />
                                        <Route
                                          path="camera"
                                          element={<CameraPage />}
                                        />
                                        <Route
                                          path="photos/albums/:albumId"
                                          element={<Photos />}
                                        />
                                        <Route
                                          path="photos/:id"
                                          element={<PhotoDetail />}
                                        />
                                        <Route
                                          path="audio"
                                          element={<AudioPage />}
                                        />
                                        <Route
                                          path="audio/playlists/:playlistId"
                                          element={<AudioPage />}
                                        />
                                        <Route
                                          path="audio/:id"
                                          element={<AudioDetail />}
                                        />
                                        <Route
                                          path="videos"
                                          element={<VideoPage />}
                                        />
                                        <Route
                                          path="videos/playlists/:playlistId"
                                          element={<VideoPage />}
                                        />
                                        <Route
                                          path="videos/:id"
                                          element={<VideoDetail />}
                                        />
                                        <Route
                                          path="sqlite"
                                          element={<Sqlite />}
                                        />
                                        <Route
                                          path="console"
                                          element={<Console />}
                                        />
                                        <Route
                                          path="debug"
                                          element={<Debug />}
                                        />
                                        <Route path="help" element={<Help />} />
                                        <Route
                                          path="help/api"
                                          element={<ApiDocsPage />}
                                        />
                                        <Route
                                          path="help/docs/:docId"
                                          element={<HelpDocPage />}
                                        />
                                        <Route
                                          path="compliance"
                                          element={<Compliance />}
                                        />
                                        <Route
                                          path="compliance/:framework/*"
                                          element={<ComplianceDocPage />}
                                        />
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
                                        <Route
                                          path="models"
                                          element={<Models />}
                                        />
                                        <Route
                                          path="settings"
                                          element={<Settings />}
                                        />
                                        <Route
                                          path="licenses"
                                          element={<Licenses />}
                                        />
                                        <Route
                                          path="sqlite/tables"
                                          element={<Tables />}
                                        />
                                        <Route
                                          path="sqlite/tables/:tableName"
                                          element={<TableRows />}
                                        />
                                        <Route
                                          path="analytics"
                                          element={<Analytics />}
                                        />
                                        <Route path="opfs" element={<Opfs />} />
                                        <Route
                                          path="cache-storage"
                                          element={<CacheStorage />}
                                        />
                                        <Route
                                          path="local-storage"
                                          element={<LocalStorage />}
                                        />
                                        <Route
                                          path="keychain"
                                          element={<Keychain />}
                                        />
                                        <Route
                                          path="keychain/:id"
                                          element={<KeychainDetail />}
                                        />
                                        <Route
                                          path="wallet"
                                          element={<Wallet />}
                                        />
                                        <Route
                                          path="wallet/:id"
                                          element={<WalletDetail />}
                                        />
                                        <Route
                                          path="admin"
                                          element={<AdminLauncher />}
                                        />
                                        <Route
                                          path="admin/redis"
                                          element={<Admin />}
                                        />
                                        <Route
                                          path="admin/postgres"
                                          element={<PostgresAdmin />}
                                        />
                                        <Route
                                          path="admin/groups"
                                          element={<GroupsAdminPage />}
                                        />
                                        <Route
                                          path="admin/groups/:id"
                                          element={<GroupDetailPageRoute />}
                                        />
                                        <Route
                                          path="admin/organizations"
                                          element={<OrganizationsAdminPage />}
                                        />
                                        <Route
                                          path="admin/organizations/:id"
                                          element={
                                            <OrganizationDetailPageRoute />
                                          }
                                        />
                                        <Route
                                          path="admin/users"
                                          element={<UsersAdminPage />}
                                        />
                                        <Route
                                          path="admin/users/ai-requests"
                                          element={<AiRequestsAdminPage />}
                                        />
                                        <Route
                                          path="admin/users/:id"
                                          element={<UsersAdminDetail />}
                                        />
                                        <Route path="sync" element={<Sync />} />
                                        <Route path="vfs" element={<Vfs />} />
                                        <Route
                                          path="classic"
                                          element={<Classic />}
                                        />
                                        <Route
                                          path="backups"
                                          element={<Backups />}
                                        />
                                      </Route>
                                    </Routes>
                                  </Suspense>
                                  <WindowRenderer />
                                </BrowserRouter>
                              </WindowManagerProvider>
                            </SSEProvider>
                          </AuthProvider>
                        </VideoProvider>
                      </AudioProvider>
                    </AppTooltipProvider>
                  </SearchProvider>
                </SettingsProvider>
              </DatabaseProvider>
              <LaserScreensaver />
            </ScreensaverProvider>
          </ThemeProvider>
        </I18nextProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
