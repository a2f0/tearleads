import { ThemeProvider } from '@rapid/ui';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import {
  ErrorBoundary,
  errorBoundaryRef
} from './components/ui/error-boundary';
import { DatabaseProvider } from './db/hooks';
import { Analytics } from './pages/Analytics';
import { CacheStorage } from './pages/CacheStorage';
import { Chat } from './pages/Chat';
import { ContactDetail } from './pages/ContactDetail';
import { Contacts } from './pages/Contacts';
import { Debug } from './pages/Debug';
import { Files } from './pages/Files';
import { LocalStorage } from './pages/LocalStorage';
import { Models } from './pages/Models';
import { MusicPage } from './pages/Music';
import { Opfs } from './pages/Opfs';
import { PhotoDetail } from './pages/PhotoDetail';
import { Photos } from './pages/Photos';
import { Settings } from './pages/Settings';
import { Sqlite } from './pages/Sqlite';
import { TableRows } from './pages/TableRows';
import { Tables } from './pages/Tables';
import './index.css';

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
        <ThemeProvider>
          <DatabaseProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<App />}>
                  <Route index element={<Files />} />
                  <Route path="contacts" element={<Contacts />} />
                  <Route path="contacts/:id" element={<ContactDetail />} />
                  <Route path="photos" element={<Photos />} />
                  <Route path="photos/:id" element={<PhotoDetail />} />
                  <Route path="audio" element={<MusicPage />} />
                  <Route path="sqlite" element={<Sqlite />} />
                  <Route path="debug" element={<Debug />} />
                  <Route path="chat" element={<Chat />} />
                  <Route path="models" element={<Models />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="tables" element={<Tables />} />
                  <Route path="tables/:tableName" element={<TableRows />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="opfs" element={<Opfs />} />
                  <Route path="cache-storage" element={<CacheStorage />} />
                  <Route path="local-storage" element={<LocalStorage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </DatabaseProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
