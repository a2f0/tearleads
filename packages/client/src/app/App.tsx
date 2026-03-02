import { Footer } from '@tearleads/ui';
import logo from '@tearleads/ui/logo.svg';
import {
  DesktopContextMenu,
  DesktopContextMenuItem,
  DesktopStartBar,
  DesktopStartButton,
  DesktopSystemTray
} from '@tearleads/window-manager';
import { Lock, Search } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const NotificationCenterTrigger = lazy(() =>
  import('@/components/notification-center').then((m) => ({
    default: m.NotificationCenterTrigger
  }))
);

import { useKeyboardHeight } from '@/hooks/ui';
import { AccountSwitcher } from '../components/AccountSwitcher';
import { MiniPlayer } from '../components/audio/MiniPlayer';
import { RuntimeLanguagePicker } from '../components/language-picker';
import { MobileMenu } from '../components/MobileMenu';
import { SettingsButton } from '../components/SettingsButton';
import { Sidebar } from '../components/Sidebar';
import { useScreensaver } from '../components/screensaver';
import { Taskbar } from '../components/taskbar';
import { DesktopBackground } from '../components/ui/desktop-background';
import { FOOTER_HEIGHT } from '../constants/layout';
import { useOptionalAuth } from '../contexts/AuthContext';
import { useWindowManagerActions } from '../contexts/WindowManagerContext';
import { setDatabasePassword } from '../db';
import { useDatabaseContext } from '../db/hooks';
import { getInstance, updateInstance } from '../db/instanceRegistry';
import { notificationStore } from '../stores/notificationStore';
import { SSESystemTrayItems } from './SSESystemTrayItems';
import { useStartMenuContextMenu } from './useStartMenuContextMenu';

/** Extra padding to add when keyboard is open (matches pb-16 = 4rem = 64px) */
const KEYBOARD_EXTRA_PADDING = 64;

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const isHome = pathname === '/';
  const { openWindow } = useWindowManagerActions();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const startMenu = useStartMenuContextMenu();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const { isUnlocked, lock, currentInstanceId, instances } = useDatabaseContext();
  const auth = useOptionalAuth();
  const isAuthenticated = auth?.isAuthenticated ?? false;
  const { activate: activateScreensaver } = useScreensaver();
  const isDesktop = !isMobile && !isTouchDevice;
  const isPasswordDeferredInContext =
    instances.find((instance) => instance.id === currentInstanceId)
      ?.passwordDeferred === true;

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

  const handleLockInstance = useCallback(async () => {
    try {
      if (isUnlocked) {
        let requiresPasswordBeforeLock = false;
        if (!isAuthenticated && currentInstanceId) {
          requiresPasswordBeforeLock = isPasswordDeferredInContext;
          if (!requiresPasswordBeforeLock && typeof indexedDB !== 'undefined') {
            const instance = await getInstance(currentInstanceId);
            requiresPasswordBeforeLock = instance?.passwordDeferred === true;
          }
        }

        if (requiresPasswordBeforeLock && currentInstanceId) {
          const password =
            typeof window.prompt === 'function'
              ? window.prompt(
                  'Set a database password before locking this instance'
                )
              : null;

          if (!password || !password.trim()) {
            notificationStore.warning(
              'Password Required',
              'Set a database password to lock this instance while signed out.'
            );
            return;
          }

          const saved = await setDatabasePassword(password, currentInstanceId);
          if (!saved) {
            notificationStore.warning(
              'Password Not Saved',
              'Could not save your database password. Please try again.'
            );
            return;
          }
          await updateInstance(currentInstanceId, { passwordDeferred: false });
        }

        activateScreensaver();
        await lock(true);
      }
    } finally {
      startMenu.close();
    }
  }, [
    activateScreensaver,
    currentInstanceId,
    isAuthenticated,
    isPasswordDeferredInContext,
    isUnlocked,
    lock,
    startMenu
  ]);

  const handleOpenSearch = useCallback(() => {
    if (isDesktop) {
      openWindow('search');
    } else {
      navigate('/search');
    }
    startMenu.close();
  }, [isDesktop, navigate, openWindow, startMenu]);

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
        onContextMenu={startMenu.handleFooterContextMenu}
        leftAction={
          <DesktopStartBar onContextMenu={startMenu.handleStartBarContextMenu}>
            <div className="hidden items-center lg:flex lg:w-[calc(16rem-1cm)]">
              <DesktopStartButton
                logoSrc={logo}
                isOpen={isSidebarOpen}
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                onContextMenu={startMenu.handleStartMenuContextMenu}
                ref={startButtonRef}
              />
            </div>
            <Taskbar onContextMenu={startMenu.handleTaskbarContextMenu} />
          </DesktopStartBar>
        }
        copyrightText=""
      />
      {startMenu.contextMenu && (
        <DesktopContextMenu
          x={startMenu.contextMenu.x}
          y={startMenu.contextMenu.y}
          onClose={startMenu.close}
        >
          <DesktopContextMenuItem
            icon={<Search className="h-4 w-4" />}
            onClick={handleOpenSearch}
          >
            Open Search
          </DesktopContextMenuItem>
          {startMenu.contextMenu.showLockAction && (
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
        <SSESystemTrayItems />
        <Suspense fallback={null}>
          <NotificationCenterTrigger />
        </Suspense>
      </DesktopSystemTray>
      <MiniPlayer />
    </div>
  );
}

export default App;
