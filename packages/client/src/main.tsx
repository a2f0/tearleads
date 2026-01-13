import { ThemeProvider } from '@rapid/ui';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { AudioProvider } from './audio';
import { InstanceChangeHandler } from './components/InstanceChangeHandler';
import {
  ErrorBoundary,
  errorBoundaryRef
} from './components/ui/error-boundary';
import { DatabaseProvider, SettingsProvider } from './db/hooks';
import { i18n } from './i18n';
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
  import('./pages/admin').then((m) => ({ default: m.Admin }))
);
const Analytics = lazy(() =>
  import('./pages/analytics').then((m) => ({ default: m.Analytics }))
);
const AudioDetail = lazy(() =>
  import('./pages/AudioDetail').then((m) => ({ default: m.AudioDetail }))
);
const AudioPage = lazy(() =>
  import('./pages/Audio').then((m) => ({ default: m.AudioPage }))
);
const CacheStorage = lazy(() =>
  import('./pages/cache-storage').then((m) => ({ default: m.CacheStorage }))
);
const Chat = lazy(() =>
  import('./pages/chat').then((m) => ({ default: m.Chat }))
);
const ContactDetail = lazy(() =>
  import('./pages/ContactDetail').then((m) => ({ default: m.ContactDetail }))
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
const DocumentDetail = lazy(() =>
  import('./pages/DocumentDetail').then((m) => ({ default: m.DocumentDetail }))
);
const Documents = lazy(() =>
  import('./pages/Documents').then((m) => ({ default: m.Documents }))
);
const Files = lazy(() =>
  import('./pages/Files').then((m) => ({ default: m.Files }))
);
const Home = lazy(() =>
  import('./pages/Home').then((m) => ({ default: m.Home }))
);
const Keychain = lazy(() =>
  import('./pages/keychain').then((m) => ({ default: m.Keychain }))
);
const KeychainDetail = lazy(() =>
  import('./pages/keychain').then((m) => ({ default: m.KeychainDetail }))
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
const Opfs = lazy(() =>
  import('./pages/opfs').then((m) => ({ default: m.Opfs }))
);
const PhotoDetail = lazy(() =>
  import('./pages/PhotoDetail').then((m) => ({ default: m.PhotoDetail }))
);
const Photos = lazy(() =>
  import('./pages/Photos').then((m) => ({ default: m.Photos }))
);
const Settings = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.Settings }))
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
const VideoPage = lazy(() =>
  import('./pages/Video').then((m) => ({ default: m.VideoPage }))
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

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <Toaster richColors closeButton position="top-center" />
            <DatabaseProvider>
              <SettingsProvider>
                <InstanceChangeHandler />
                <AudioProvider>
                  <VideoProvider>
                    <SSEProvider>
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
                              <Route path="files" element={<Files />} />
                              <Route path="contacts" element={<Contacts />} />
                              <Route
                                path="contacts/new"
                                element={<ContactNew />}
                              />
                              <Route
                                path="contacts/:id"
                                element={<ContactDetail />}
                              />
                              <Route path="documents" element={<Documents />} />
                              <Route
                                path="documents/:id"
                                element={<DocumentDetail />}
                              />
                              <Route path="photos" element={<Photos />} />
                              <Route
                                path="photos/:id"
                                element={<PhotoDetail />}
                              />
                              <Route path="audio" element={<AudioPage />} />
                              <Route
                                path="audio/:id"
                                element={<AudioDetail />}
                              />
                              <Route path="videos" element={<VideoPage />} />
                              <Route
                                path="videos/:id"
                                element={<VideoDetail />}
                              />
                              <Route path="sqlite" element={<Sqlite />} />
                              <Route path="debug" element={<Debug />} />
                              <Route path="chat" element={<Chat />} />
                              <Route path="models" element={<Models />} />
                              <Route path="settings" element={<Settings />} />
                              <Route path="licenses" element={<Licenses />} />
                              <Route path="tables" element={<Tables />} />
                              <Route
                                path="tables/:tableName"
                                element={<TableRows />}
                              />
                              <Route path="analytics" element={<Analytics />} />
                              <Route path="opfs" element={<Opfs />} />
                              <Route
                                path="cache-storage"
                                element={<CacheStorage />}
                              />
                              <Route
                                path="local-storage"
                                element={<LocalStorage />}
                              />
                              <Route path="keychain" element={<Keychain />} />
                              <Route
                                path="keychain/:id"
                                element={<KeychainDetail />}
                              />
                              <Route path="admin" element={<Admin />} />
                            </Route>
                          </Routes>
                        </Suspense>
                      </BrowserRouter>
                    </SSEProvider>
                  </VideoProvider>
                </AudioProvider>
              </SettingsProvider>
            </DatabaseProvider>
          </ThemeProvider>
        </I18nextProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
