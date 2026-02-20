import { Footer } from '@tearleads/ui';
import logo from '@tearleads/ui/logo.svg';
import {
  DesktopContextMenu,
  DesktopContextMenuItem,
  DesktopStartBar,
  DesktopStartButton,
  DesktopSystemTray,
  WindowConnectionIndicator
} from '@tearleads/window-manager';
import { Info, Lock, Search } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const NotificationCenterTrigger = lazy(() =>
  import('@/components/notification-center').then((m) => ({
    default: m.NotificationCenterTrigger
  }))
);

import { useKeyboardHeight } from '@/hooks/ui';
import { AccountSwitcher } from './components/AccountSwitcher';
import { MiniPlayer } from './components/audio/MiniPlayer';
import { RuntimeLanguagePicker } from './components/language-picker';
import { MobileMenu } from './components/MobileMenu';
import { SettingsButton } from './components/SettingsButton';
import { Sidebar } from './components/Sidebar';
import { SSEConnectionDialog } from './components/SSEConnectionDialog';
import { useScreensaver } from './components/screensaver';
import { Taskbar } from './components/taskbar';
import { DesktopBackground } from './components/ui/desktop-background';
import { FOOTER_HEIGHT } from './constants/layout';
import { useWindowManagerActions } from './contexts/WindowManagerContext';
import { useDatabaseContext } from './db/hooks';
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
  const navigate = useNavigate();
  const pathname = location.pathname;
  const isHome = pathname === '/';
  const { openWindow } = useWindowManagerActions();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [startMenuContextMenu, setStartMenuContextMenu] = useState<{
    x: number;
    y: number;
    showLockAction: boolean;
  } | null>(null);
  const [sseContextMenu, setSseContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isSseDialogOpen, setIsSseDialogOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const { isUnlocked, lock } = useDatabaseContext();
  const { activate: activateScreensaver } = useScreensaver();
  const isDesktop = !isMobile && !isTouchDevice;

  useEffect(() => {
    if (pathname) {
      setIsSidebarOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const pointerQuery = window.matchMedia('(pointer: coarse)');

    const handleMediaChange = (event: MediaQueryListEvent) =>
      setIsMobile(event.matches);
    const updateTouchState = () => {
      const hasTouch = pointerQuery.matches || navigator.maxTouchPoints > 0;
      setIsTouchDevice(hasTouch);
    };

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleMediaChange);
    updateTouchState();
    pointerQuery.addEventListener('change', updateTouchState);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
      pointerQuery.removeEventListener('change', updateTouchState);
    };
  }, []);

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
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setStartMenuContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: true
      });
    },
    []
  );

  const handleStartBarContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      event.preventDefault();
      setStartMenuContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: true
      });
    },
    []
  );

  const handleTaskbarContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setStartMenuContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: false
      });
    },
    []
  );

  const handleFooterContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('[data-testid="start-bar"]')
      ) {
        return;
      }
      event.preventDefault();
      setStartMenuContextMenu({
        x: event.clientX,
        y: event.clientY,
        showLockAction: false
      });
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

  const handleOpenSearch = useCallback(() => {
    if (isDesktop) {
      openWindow('search');
    } else {
      navigate('/search');
    }
    setStartMenuContextMenu(null);
  }, [isDesktop, navigate, openWindow]);

  const handleSseContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setSseContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseSseContextMenu = useCallback(() => {
    setSseContextMenu(null);
  }, []);

  const handleShowConnectionDetails = useCallback(() => {
    setIsSseDialogOpen(true);
    setSseContextMenu(null);
  }, []);

  const handleCloseSseDialog = useCallback(() => {
    setIsSseDialogOpen(false);
  }, []);

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
        onContextMenu={handleFooterContextMenu}
        leftAction={
          <DesktopStartBar onContextMenu={handleStartBarContextMenu}>
            <div className="hidden items-center lg:flex lg:w-[calc(16rem-1cm)]">
              <DesktopStartButton
                logoSrc={logo}
                isOpen={isSidebarOpen}
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                onContextMenu={handleStartMenuContextMenu}
                ref={startButtonRef}
              />
            </div>
            <Taskbar onContextMenu={handleTaskbarContextMenu} />
          </DesktopStartBar>
        }
        copyrightText=""
      />
      {startMenuContextMenu && (
        <DesktopContextMenu
          x={startMenuContextMenu.x}
          y={startMenuContextMenu.y}
          onClose={handleCloseStartMenuContextMenu}
        >
          <DesktopContextMenuItem
            icon={<Search className="h-4 w-4" />}
            onClick={handleOpenSearch}
          >
            Open Search
          </DesktopContextMenuItem>
          {startMenuContextMenu.showLockAction && (
            <DesktopContextMenuItem
              icon={<Lock className="h-4 w-4" />}
              onClick={handleLockInstance}
            >
              Lock Instance
            </DesktopContextMenuItem>
          )}
        </DesktopContextMenu>
      )}
      <DesktopSystemTray footerHeight={FOOTER_HEIGHT}>
        <RuntimeLanguagePicker />
        {sse && (
          <WindowConnectionIndicator
            state={sse.connectionState}
            tooltip={t(sseTooltipKeys[sse.connectionState])}
            onClick={handleShowConnectionDetails}
            onContextMenu={handleSseContextMenu}
          />
        )}
        <Suspense fallback={null}>
          <NotificationCenterTrigger />
        </Suspense>
      </DesktopSystemTray>
      <MiniPlayer />
      {sseContextMenu && (
        <DesktopContextMenu
          x={sseContextMenu.x}
          y={sseContextMenu.y}
          onClose={handleCloseSseContextMenu}
        >
          <DesktopContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={handleShowConnectionDetails}
          >
            Connection Details
          </DesktopContextMenuItem>
        </DesktopContextMenu>
      )}
      {sse && (
        <SSEConnectionDialog
          isOpen={isSseDialogOpen}
          onClose={handleCloseSseDialog}
          connectionState={sse.connectionState}
        />
      )}
    </div>
  );
}

export default App;
