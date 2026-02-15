import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FOOTER_HEIGHT } from '@/constants/layout';
import { WINDOW_PATHS } from '@/constants/windowPaths';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useTypedTranslation } from '@/i18n';
import { isAppFeatureEnabled } from '@/lib/app-config';
import { cn } from '@/lib/utils';
import { adminFlyoutItems, debugFlyoutItems, navItems } from './navItems';
import { SidebarAdminFlyoutMenu } from './SidebarAdminFlyoutMenu';
import { SidebarNavList } from './SidebarNavList';
import { SidebarRouteContextMenu } from './SidebarRouteContextMenu';
import type { SidebarContextMenuState, SidebarProps } from './types';

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { isOpen, onClose },
  ref
) {
  const { t } = useTypedTranslation('menu');
  const navigate = useNavigate();
  const location = useLocation();
  const { openWindow } = useWindowManagerActions();

  const [isMobile, setIsMobile] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [contextMenu, setContextMenu] =
    useState<SidebarContextMenuState | null>(null);
  const [adminFlyoutOpen, setAdminFlyoutOpen] = useState(false);
  const [debugFlyoutOpen, setDebugFlyoutOpen] = useState(false);
  const [adminButtonRect, setAdminButtonRect] = useState<DOMRect | null>(null);
  const [debugButtonRect, setDebugButtonRect] = useState<DOMRect | null>(null);
  const adminButtonRef = useRef<HTMLButtonElement>(null);
  const debugButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Corresponds to Tailwind's `lg` breakpoint (min-width: 1024px).
    // isMobile is true when screen is smaller than that.
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const pointerQuery = window.matchMedia('(pointer: coarse)');

    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
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

  const isDesktop = !isMobile && !isTouchDevice;

  const sidebarItems = useMemo(() => {
    // Filter by enabled features first
    const featureFiltered = navItems.filter(
      (item) =>
        !item.requiredFeature || isAppFeatureEnabled(item.requiredFeature)
    );

    // Then filter desktop-specific items
    return isDesktop
      ? featureFiltered.filter(
          (item) =>
            item.path !== '/admin/users' && item.path !== '/admin/organizations'
        )
      : featureFiltered;
  }, [isDesktop]);

  const handleClick = useCallback(
    (path: string) => {
      const windowType = WINDOW_PATHS[path];
      if (windowType && isDesktop) {
        // Open in floating window on desktop if supported
        openWindow(windowType);
      } else {
        // Navigate for mobile or non-window paths
        navigate(path);
      }
      onClose();
    },
    [isDesktop, navigate, openWindow, onClose]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, path: string) => {
      if (!isDesktop) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ x: event.clientX, y: event.clientY, path });
    },
    [isDesktop]
  );

  const handleOpenRoute = useCallback(() => {
    if (contextMenu) {
      navigate(contextMenu.path);
      onClose();
    }
    setContextMenu(null);
  }, [contextMenu, navigate, onClose]);

  const handleOpenInWindow = useCallback(() => {
    if (contextMenu) {
      const windowType = WINDOW_PATHS[contextMenu.path];
      if (windowType) {
        openWindow(windowType);
        onClose();
      }
    }
    setContextMenu(null);
  }, [contextMenu, openWindow, onClose]);

  return (
    <aside
      id="sidebar"
      ref={ref}
      className={cn(
        'hidden w-64 shrink-0 flex-col border-t border-r bg-background',
        isOpen
          ? 'lg:fixed lg:left-0 lg:z-[60] lg:flex lg:shadow-lg'
          : 'lg:hidden'
      )}
      style={
        isOpen
          ? {
              bottom: FOOTER_HEIGHT,
              maxHeight: `calc(100vh - ${FOOTER_HEIGHT}px)`
            }
          : undefined
      }
    >
      <nav className="max-h-full overflow-y-auto p-4">
        <SidebarNavList
          items={sidebarItems}
          isDesktop={isDesktop}
          activePathname={location.pathname}
          adminFlyoutItems={adminFlyoutItems}
          debugFlyoutItems={debugFlyoutItems}
          adminButtonRef={adminButtonRef}
          debugButtonRef={debugButtonRef}
          onAdminFlyoutOpenChange={setAdminFlyoutOpen}
          onDebugFlyoutOpenChange={setDebugFlyoutOpen}
          onAdminButtonRectChange={setAdminButtonRect}
          onDebugButtonRectChange={setDebugButtonRect}
          onItemClick={handleClick}
          onItemContextMenu={handleContextMenu}
          t={t}
        />
      </nav>

      <SidebarAdminFlyoutMenu
        isOpen={adminFlyoutOpen}
        buttonRect={adminButtonRect}
        activePathname={location.pathname}
        items={adminFlyoutItems}
        ariaLabel="Admin submenu"
        testIdPrefix="admin"
        onItemClick={handleClick}
        onItemContextMenu={handleContextMenu}
        onOpenChange={setAdminFlyoutOpen}
        t={t}
      />
      <SidebarAdminFlyoutMenu
        isOpen={debugFlyoutOpen}
        buttonRect={debugButtonRect}
        activePathname={location.pathname}
        items={debugFlyoutItems}
        ariaLabel="Debug submenu"
        testIdPrefix="debug"
        onItemClick={handleClick}
        onItemContextMenu={handleContextMenu}
        onOpenChange={setDebugFlyoutOpen}
        t={t}
      />

      <SidebarRouteContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpenRoute={handleOpenRoute}
        onOpenInWindow={handleOpenInWindow}
        canOpenInWindow={(path) => path in WINDOW_PATHS}
      />
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';
