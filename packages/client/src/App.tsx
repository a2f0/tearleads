import { ConnectionIndicator, Footer } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { AccountSwitcher } from './components/AccountSwitcher';
import { MiniPlayer } from './components/audio/MiniPlayer';
import { HUDTrigger } from './components/hud';
import { MobileMenu } from './components/MobileMenu';
import { SettingsButton } from './components/SettingsButton';
import { Sidebar } from './components/Sidebar';
import { Taskbar } from './components/taskbar';
import { DesktopBackground } from './components/ui/desktop-background';
import { useSSEContext } from './sse';

const sseTooltipKeys = {
  connected: 'sseConnected',
  connecting: 'sseConnecting',
  disconnected: 'sseDisconnected'
} as const;

function App() {
  const { t } = useTranslation('tooltips');
  const sse = useSSEContext();
  const location = useLocation();
  const pathname = location.pathname;
  const isHome = pathname === '/';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (pathname) {
      setIsSidebarOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (!isSidebarOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sidebarRef.current?.contains(target)) return;
      if (startButtonRef.current?.contains(target)) return;
      setIsSidebarOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isSidebarOpen]);

  return (
    <div
      className="safe-area-inset flex min-h-screen flex-col bg-background"
      data-testid="app-container"
    >
      <div className="flex flex-1">
        <Sidebar
          ref={sidebarRef}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
        <div className="relative flex min-w-0 flex-1 flex-col">
          {isHome && <DesktopBackground />}
          <header className="w-full px-4 py-4">
            <div className="flex items-center justify-end gap-1">
              <MobileMenu />
              <SettingsButton />
              <AccountSwitcher />
            </div>
          </header>
          <main className="relative flex min-w-0 flex-1 flex-col pb-14">
            <div className="container relative mx-auto flex max-w-2xl flex-1 flex-col px-4 pb-16 lg:max-w-none lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <Footer
        version={undefined}
        leftAction={
          <div className="flex items-center gap-2">
            <div className="hidden items-center lg:flex lg:w-[calc(16rem-1cm)]">
              <button
                type="button"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                ref={startButtonRef}
                className="hidden items-center justify-center lg:flex"
                aria-label="Toggle sidebar"
                aria-pressed={isSidebarOpen}
                aria-controls="sidebar"
                data-testid="start-button"
              >
                <img src={logo} alt="" className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
            <Taskbar />
          </div>
        }
        copyrightText=""
      />
      <div
        className="fixed right-4 bottom-6 z-50"
        style={{
          bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          right: 'max(1rem, env(safe-area-inset-right, 0px))'
        }}
      >
        <div className="flex items-center gap-2">
          {sse && (
            <div className="flex h-6 w-6 items-center justify-center">
              {/* Optical alignment tweak to match the HUD icon's center. */}
              <ConnectionIndicator
                state={sse.connectionState}
                tooltip={t(sseTooltipKeys[sse.connectionState])}
                className="translate-y-1"
              />
            </div>
          )}
          <HUDTrigger />
        </div>
      </div>
      <MiniPlayer />
    </div>
  );
}

export default App;
