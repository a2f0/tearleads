import {
  AppWindow,
  Archive,
  BarChart3,
  Bot,
  BookOpen,
  Bug,
  Database,
  ExternalLink,
  FileIcon,
  FileText,
  Film,
  HardDrive,
  Home,
  ImageIcon,
  Key,
  Mail,
  MessageSquare,
  Music,
  RefreshCw,
  Settings,
  Shield,
  StickyNote,
  Terminal,
  Users
} from 'lucide-react';
import { forwardRef, useCallback, useEffect, useState } from 'react';
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
    icon: Users,
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
    path: '/docs',
    icon: BookOpen,
    labelKey: 'docs',
    inMobileMenu: true,
    testId: 'docs-link'
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
    path: '/admin/redis',
    icon: Shield,
    labelKey: 'admin',
    inMobileMenu: true,
    testId: 'admin-link'
  },
  {
    path: '/admin/postgres',
    icon: Database,
    labelKey: 'postgresAdmin',
    inMobileMenu: true,
    testId: 'postgres-admin-link'
  },
  {
    path: '/sync',
    icon: RefreshCw,
    labelKey: 'sync',
    inMobileMenu: true,
    testId: 'sync-link'
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
  '/docs': 'docs',
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
  '/admin/redis': 'admin',
  '/admin/postgres': 'admin-postgres',
  '/sync': 'sync'
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
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);
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
