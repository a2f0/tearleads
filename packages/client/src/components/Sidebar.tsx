import {
  AppWindow,
  Archive,
  BarChart3,
  Bot,
  Bug,
  Building2,
  ChevronRight,
  CircleHelp,
  Cpu,
  Database,
  ExternalLink,
  FileIcon,
  FileText,
  Film,
  FolderTree,
  HardDrive,
  Home,
  ImageIcon,
  Key,
  Lock,
  Mail,
  MessageSquare,
  Music,
  RefreshCw,
  Settings,
  Shield,
  StickyNote,
  Terminal,
  User,
  Users as UsersIcon
} from 'lucide-react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ui/context-menu/ContextMenu';
import { ContextMenuItem } from '@/components/ui/context-menu/ContextMenuItem';
import { FOOTER_HEIGHT } from '@/constants/layout';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import type { MenuKeys } from '@/i18n';
import { useTypedTranslation } from '@/i18n';
import { cn } from '@/lib/utils';

export interface NavItem {
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: MenuKeys;
  inMobileMenu?: boolean;
  testId?: string;
}

export const navItems: NavItem[] = [
  {
    path: '/',
    icon: Home,
    labelKey: 'home',
    inMobileMenu: true,
    testId: 'home-link'
  },
  {
    path: '/files',
    icon: FileIcon,
    labelKey: 'files',
    inMobileMenu: true,
    testId: 'files-link'
  },
  {
    path: '/contacts',
    icon: UsersIcon,
    labelKey: 'contacts',
    inMobileMenu: true,
    testId: 'contacts-link'
  },
  {
    path: '/photos',
    icon: ImageIcon,
    labelKey: 'photos',
    inMobileMenu: true,
    testId: 'photos-link'
  },
  {
    path: '/documents',
    icon: FileText,
    labelKey: 'documents',
    inMobileMenu: true,
    testId: 'documents-link'
  },
  {
    path: '/help',
    icon: CircleHelp,
    labelKey: 'help',
    inMobileMenu: true,
    testId: 'help-link'
  },
  {
    path: '/notes',
    icon: StickyNote,
    labelKey: 'notes',
    inMobileMenu: true,
    testId: 'notes-link'
  },
  {
    path: '/audio',
    icon: Music,
    labelKey: 'audio',
    inMobileMenu: true,
    testId: 'audio-link'
  },
  {
    path: '/videos',
    icon: Film,
    labelKey: 'videos',
    inMobileMenu: true,
    testId: 'videos-link'
  },
  {
    path: '/analytics',
    icon: BarChart3,
    labelKey: 'analytics',
    inMobileMenu: true,
    testId: 'analytics-link'
  },
  {
    path: '/sqlite',
    icon: Database,
    labelKey: 'sqlite',
    inMobileMenu: true,
    testId: 'sqlite-link'
  },
  {
    path: '/console',
    icon: Terminal,
    labelKey: 'console',
    inMobileMenu: true,
    testId: 'console-link'
  },
  {
    path: '/debug',
    icon: Bug,
    labelKey: 'debug',
    inMobileMenu: true,
    testId: 'debug-link'
  },
  {
    path: '/opfs',
    icon: HardDrive,
    labelKey: 'opfs',
    inMobileMenu: true,
    testId: 'opfs-link'
  },
  {
    path: '/cache-storage',
    icon: Archive,
    labelKey: 'cacheStorage',
    inMobileMenu: true,
    testId: 'cache-storage-link'
  },
  {
    path: '/local-storage',
    icon: Database,
    labelKey: 'localStorage',
    inMobileMenu: true,
    testId: 'local-storage-link'
  },
  {
    path: '/keychain',
    icon: Key,
    labelKey: 'keychain',
    inMobileMenu: true,
    testId: 'keychain-link'
  },
  {
    path: '/chat',
    icon: MessageSquare,
    labelKey: 'chat',
    inMobileMenu: true,
    testId: 'chat-link'
  },
  {
    path: '/mls-chat',
    icon: Lock,
    labelKey: 'mlsChat',
    inMobileMenu: true,
    testId: 'mls-chat-link'
  },
  {
    path: '/email',
    icon: Mail,
    labelKey: 'email',
    inMobileMenu: true,
    testId: 'email-link'
  },
  {
    path: '/models',
    icon: Bot,
    labelKey: 'models',
    inMobileMenu: true,
    testId: 'models-link'
  },
  {
    path: '/admin',
    icon: Shield,
    labelKey: 'admin',
    inMobileMenu: true,
    testId: 'admin-link'
  },
  {
    path: '/admin/users',
    icon: User,
    labelKey: 'adminUsers',
    inMobileMenu: true,
    testId: 'admin-users-link'
  },
  {
    path: '/admin/organizations',
    icon: Building2,
    labelKey: 'organizations',
    inMobileMenu: true,
    testId: 'admin-organizations-link'
  },
  {
    path: '/sync',
    icon: RefreshCw,
    labelKey: 'sync',
    inMobileMenu: true,
    testId: 'sync-link'
  },
  {
    path: '/v86',
    icon: Cpu,
    labelKey: 'v86',
    inMobileMenu: true,
    testId: 'v86-link'
  },
  {
    path: '/vfs',
    icon: FolderTree,
    labelKey: 'vfs',
    inMobileMenu: true,
    testId: 'vfs-link'
  },
  {
    path: '/settings',
    icon: Settings,
    labelKey: 'settings',
    inMobileMenu: true,
    testId: 'settings-link'
  }
];

// AGENT GUARDRAIL: When adding a new window path here, ensure parity with:
// - Home.tsx PATH_TO_WINDOW_TYPE mapping
// - WindowManagerContext.tsx WindowType union
// - WindowRenderer.tsx switch cases
const WINDOW_PATHS: Partial<Record<string, WindowType>> = {
  '/notes': 'notes',
  '/console': 'console',
  '/settings': 'settings',
  '/files': 'files',
  '/help': 'help',
  '/email': 'email',
  '/contacts': 'contacts',
  '/photos': 'photos',
  '/documents': 'documents',
  '/videos': 'videos',
  '/keychain': 'keychain',
  '/sqlite': 'sqlite',
  '/opfs': 'opfs',
  '/debug': 'debug',
  '/cache-storage': 'cache-storage',
  '/local-storage': 'local-storage',
  '/chat': 'chat',
  '/analytics': 'analytics',
  '/audio': 'audio',
  '/models': 'models',
  '/admin': 'admin',
  '/admin/redis': 'admin-redis',
  '/admin/postgres': 'admin-postgres',
  '/admin/groups': 'admin-groups',
  '/admin/users': 'admin-users',
  '/admin/organizations': 'admin-organizations',
  '/sync': 'sync',
  '/v86': 'v86',
  '/vfs': 'vfs',
  '/mls-chat': 'mls-chat'
};

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { isOpen, onClose },
  ref
) {
  const { t } = useTypedTranslation('menu');
  const navigate = useNavigate();
  const location = useLocation();
  const { openWindow } = useWindowManager();
  const [isMobile, setIsMobile] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const [adminFlyoutOpen, setAdminFlyoutOpen] = useState(false);
  const [adminButtonRect, setAdminButtonRect] = useState<DOMRect | null>(null);
  const adminButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Corresponds to Tailwind's `lg` breakpoint (min-width: 1024px).
    // isMobile is true when screen is smaller than that.
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const pointerQuery = window.matchMedia('(pointer: coarse)');

    const handleMediaChange = (e: MediaQueryListEvent) =>
      setIsMobile(e.matches);
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

  const adminFlyoutItems = [
    { path: '/admin/redis', labelKey: 'redis' as const, icon: Database },
    { path: '/admin/postgres', labelKey: 'postgres' as const, icon: Database },
    { path: '/admin/groups', labelKey: 'groups' as const, icon: UsersIcon },
    {
      path: '/admin/organizations',
      labelKey: 'organizations' as const,
      icon: Building2
    },
    { path: '/admin/users', labelKey: 'adminUsers' as const, icon: User }
  ];

  // On desktop, filter out /admin/users from main nav since it's in the flyout
  const sidebarItems = isDesktop
    ? navItems.filter(
        (item) =>
          item.path !== '/admin/users' && item.path !== '/admin/organizations'
      )
    : navItems;

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
    (e: React.MouseEvent, path: string) => {
      if (!isDesktop) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, path });
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

  const canOpenInWindow = (path: string) => path in WINDOW_PATHS;

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
        <ul className="space-y-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isAdminFlyout = isDesktop && item.path === '/admin';
            const isAdminActive =
              isAdminFlyout &&
              adminFlyoutItems.some((subItem) =>
                location.pathname.startsWith(subItem.path)
              );
            const isActive =
              isAdminActive ||
              (item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path));
            if (isAdminFlyout) {
              return (
                <li
                  key={item.path}
                  onMouseEnter={() => {
                    setAdminFlyoutOpen(true);
                    if (adminButtonRef.current) {
                      setAdminButtonRect(
                        adminButtonRef.current.getBoundingClientRect()
                      );
                    }
                  }}
                  onMouseLeave={() => setAdminFlyoutOpen(false)}
                >
                  <button
                    ref={adminButtonRef}
                    type="button"
                    data-testid={item.testId}
                    onClick={() => handleClick(item.path)}
                    onContextMenu={(e) => handleContextMenu(e, item.path)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-medium text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                    aria-haspopup="menu"
                  >
                    <Icon className="h-5 w-5" />
                    {t(item.labelKey)}
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              );
            }

            return (
              <li key={item.path}>
                <button
                  type="button"
                  data-testid={item.testId}
                  onClick={() => handleClick(item.path)}
                  onContextMenu={(e) => handleContextMenu(e, item.path)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-medium text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {t(item.labelKey)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {adminFlyoutOpen && adminButtonRect && (
        <div
          className="fixed z-[70] min-w-44 pl-2"
          style={{
            left: adminButtonRect.right,
            top: adminButtonRect.top
          }}
          role="menu"
          aria-label="Admin submenu"
          data-testid="admin-flyout-menu"
          onMouseEnter={() => setAdminFlyoutOpen(true)}
          onMouseLeave={() => setAdminFlyoutOpen(false)}
        >
          <div className="rounded-md border bg-background py-1 shadow-lg">
            {adminFlyoutItems.map((subItem) => {
              const SubIcon = subItem.icon;
              const isSubActive = location.pathname.startsWith(subItem.path);
              return (
                <button
                  key={subItem.path}
                  type="button"
                  data-testid={`admin-flyout-${subItem.labelKey}`}
                  onClick={() => handleClick(subItem.path)}
                  onContextMenu={(e) => handleContextMenu(e, subItem.path)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    isSubActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                  role="menuitem"
                >
                  <SubIcon className="h-4 w-4" />
                  {t(subItem.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            onClick={handleOpenRoute}
          >
            Open
          </ContextMenuItem>
          {canOpenInWindow(contextMenu.path) && (
            <ContextMenuItem
              icon={<AppWindow className="h-4 w-4" />}
              onClick={handleOpenInWindow}
            >
              Open in Window
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';
