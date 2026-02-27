import { configureBackupsRuntime } from '@tearleads/backups';
import { ThemeProvider } from '@tearleads/ui';
import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppRoutes } from './AppRoutes';
import { AudioProvider } from './audio';
import { clientBackupsRuntime } from './backups/backupsRuntime';
import { AppTooltipProvider } from './components/AppTooltipProvider';
import { AuthInstanceBinding } from './components/AuthInstanceBinding';
import { AndroidMediaSessionBridge } from './components/audio/AndroidMediaSessionBridge';
import { GlobalSettingsEffects } from './components/GlobalSettingsEffects';
import { InstanceChangeHandler } from './components/InstanceChangeHandler';
import {
  LaserScreensaver,
  ScreensaverProvider
} from './components/screensaver';
import { ErrorBoundary, errorBoundaryRef } from './components/ui/ErrorBoundary';
import { VfsRealtimeSyncBridge } from './components/VfsRealtimeSyncBridge';
import { VfsRematerializationBootstrap } from './components/VfsRematerializationBootstrap';
import { WindowRenderer } from './components/window-renderer';
import { AuthProvider } from './contexts/AuthContext';
import { OrgProvider } from './contexts/OrgContext';
import { VfsOrchestratorProvider } from './contexts/VfsOrchestratorContext';
import { WindowManagerProvider } from './contexts/WindowManagerContext';
import { ClientSettingsProvider, DatabaseProvider } from './db/hooks';
import { i18n } from './i18n';
import { installConsoleErrorCapture } from './lib/consoleErrorCapture';
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
configureBackupsRuntime(clientBackupsRuntime);

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
                <ClientSettingsProvider>
                  <GlobalSettingsEffects />
                  <SearchProvider>
                    <AppTooltipProvider>
                      <InstanceChangeHandler />
                      <AudioProvider>
                        <AndroidMediaSessionBridge />
                        <VideoProvider>
                          <AuthProvider>
                            <AuthInstanceBinding />
                            <OrgProvider>
                              <VfsOrchestratorProvider>
                                <VfsRematerializationBootstrap />
                                <SSEProvider>
                                  <VfsRealtimeSyncBridge />
                                  <WindowManagerProvider>
                                    <BrowserRouter>
                                      <Suspense
                                        fallback={
                                          <div className="p-8 text-center text-muted-foreground">
                                            Loading...
                                          </div>
                                        }
                                      >
                                        <AppRoutes />
                                      </Suspense>
                                      <WindowRenderer />
                                    </BrowserRouter>
                                  </WindowManagerProvider>
                                </SSEProvider>
                              </VfsOrchestratorProvider>
                            </OrgProvider>
                          </AuthProvider>
                        </VideoProvider>
                      </AudioProvider>
                    </AppTooltipProvider>
                  </SearchProvider>
                </ClientSettingsProvider>
              </DatabaseProvider>
              <LaserScreensaver />
            </ScreensaverProvider>
          </ThemeProvider>
        </I18nextProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
