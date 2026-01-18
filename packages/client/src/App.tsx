import { ConnectionIndicator, Footer } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AccountSwitcher } from './components/AccountSwitcher';
import { MiniPlayer } from './components/audio/MiniPlayer';
import { HUDTrigger } from './components/hud';
import { MobileMenu } from './components/MobileMenu';
import { SettingsButton } from './components/SettingsButton';
import { Sidebar } from './components/Sidebar';
import { Taskbar } from './components/taskbar';
import { DesktopBackground } from './components/ui/desktop-background';
import { WindowRenderer } from './components/window-renderer';
import { useAppVersion } from './hooks/useAppVersion';
import { useSSEContext } from './sse';

const sseTooltipKeys = {
  connected: 'sseConnected',
  connecting: 'sseConnecting',
  disconnected: 'sseDisconnected'
} as const;

function App() {
  const { t } = useTranslation('tooltips');
  const version = useAppVersion();
  const sse = useSSEContext();
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  );

  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/');
  }, [navigate]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      className="safe-area-inset flex min-h-screen flex-col bg-background"
      data-testid="app-container"
    >
      <div className="flex flex-1">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
        <div className="relative flex min-w-0 flex-1 flex-col">
          {isHome && <DesktopBackground />}
          <header className="w-full px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center">
                {isMobile && !isHome && (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                    aria-label="Go back"
                    data-testid="mobile-back-button"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
              <MobileMenu />
              <SettingsButton />
              <AccountSwitcher />
              </div>
            </div>
          </header>
          <main className="relative flex min-w-0 flex-1 flex-col pb-20">
            <div className="container relative mx-auto flex max-w-2xl flex-1 flex-col px-4 pb-16 lg:max-w-none lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <Footer
        version={version}
        connectionIndicator={
          sse && (
            <ConnectionIndicator
              state={sse.connectionState}
              tooltip={t(sseTooltipKeys[sse.connectionState])}
            />
          )
        }
        rightAction={
          <div className="flex items-center gap-2">
            <Taskbar />
            <HUDTrigger />
          </div>
        }
      >
        <p>&copy; {new Date().getFullYear()} Tearleads. All rights reserved.</p>
      </Footer>
      <button
        type="button"
        onClick={() => setIsSidebarOpen((prev) => !prev)}
        className="fixed bottom-6 left-4 z-50 hidden items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-2 font-semibold text-foreground text-sm shadow-lg backdrop-blur lg:flex"
        aria-label="Toggle sidebar"
        aria-pressed={isSidebarOpen}
        aria-controls="sidebar"
        data-testid="start-button"
        style={{
          bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          left: 'max(1rem, env(safe-area-inset-left, 0px))'
        }}
      >
        <img src={logo} alt="" className="h-5 w-5" aria-hidden="true" />
        <span>Start</span>
      </button>
      <MiniPlayer />
      <WindowRenderer />
    </div>
  );
}

export default App;
