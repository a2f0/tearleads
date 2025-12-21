import { ThemeProvider } from '@rapid/ui';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ui/error-boundary';
import { DatabaseProvider } from './db/hooks';
import { Debug } from './pages/Debug';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import './index.css';

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
                  <Route index element={<Home />} />
                  <Route path="debug" element={<Debug />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </DatabaseProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
