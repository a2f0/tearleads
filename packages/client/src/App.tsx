import { ConnectionIndicator, Footer } from '@rapid/ui';
import logo from '@rapid/ui/logo.svg';
import { Lock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { AccountSwitcher } from './components/AccountSwitcher';
import { MiniPlayer } from './components/audio/MiniPlayer';
import { HUDTrigger } from './components/hud';
import { MobileMenu } from './components/MobileMenu';
import { SettingsButton } from './components/SettingsButton';
import { Sidebar } from './components/Sidebar';
import { useScreensaver } from './components/screensaver';
import { Taskbar } from './components/taskbar';
import { ContextMenu } from './components/ui/context-menu/ContextMenu';
import { ContextMenuItem } from './components/ui/context-menu/ContextMenuItem';
import { DesktopBackground } from './components/ui/desktop-background';
import { FOOTER_HEIGHT } from './constants/layout';
import { useDatabaseContext } from './db/hooks';
import { useKeyboardHeight } from './hooks/useKeyboardHeight';
import { useSSEContext } from './sse';

/** Extra padding to add when keyboard is open (matches pb-16 = 4rem = 64px) */
const KEYBOARD_EXTRA_PADDING = 64;

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
  const [startMenuContextMenu, setStartMenuContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const { isUnlocked, lock } = useDatabaseContext();
  const { activate: activateScreensaver } = useScreensaver();

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

  const handleStartMenuContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setStartMenuContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseStartMenuContextMenu = useCallback(() => {
    setStartMenuContextMenu(null);
  }, []);

  const handleLockInstance = useCallback(async () => {
    try {
      activateScreensaver();
      if (isUnlocked) {
        await lock(true);
      }
    } finally {
      setStartMenuContextMenu(null);
    }
  }, [activateScreensaver, isUnlocked, lock]);

  return (
    <div
      className="safe-area-inset flex h-dvh max-h-dvh flex-col bg-background"
      data-testid="app-container"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          ref={sidebarRef}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {isHome && <DesktopBackground />}
          <header className="w-full px-4 py-4">
            <div className="flex items-center justify-end gap-1">
              <MobileMenu />
              <SettingsButton />
              <AccountSwitcher />
            </div>
          </header>
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-14">
            <div
              className="container relative mx-auto flex min-h-0 max-w-2xl flex-1 flex-col overflow-auto px-4 pb-16 lg:max-w-none lg:px-8"
              style={{
                paddingBottom:
                  keyboardHeight > 0
                    ? `${keyboardHeight + KEYBOARD_EXTRA_PADDING}px`
                    : undefined
              }}
            >
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
                onContextMenu={handleStartMenuContextMenu}
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
      {startMenuContextMenu && (
        <ContextMenu
          x={startMenuContextMenu.x}
          y={startMenuContextMenu.y}
          onClose={handleCloseStartMenuContextMenu}
        >
          <ContextMenuItem
            icon={<Lock className="h-4 w-4" />}
            onClick={handleLockInstance}
          >
            Lock Instance
          </ContextMenuItem>
        </ContextMenu>
      )}
      <div
        className="fixed right-4 z-50 flex h-6 items-center"
        style={{
          bottom: `calc(${FOOTER_HEIGHT / 2}px - 0.75rem + env(safe-area-inset-bottom, 0px))`,
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
