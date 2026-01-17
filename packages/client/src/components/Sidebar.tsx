import {
  AppWindow,
  Archive,
  BarChart3,
  Bot,
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
  Settings,
  Shield,
  StickyNote,
  Table2,
  Terminal,
  Users
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ui/context-menu/ContextMenu';
import { ContextMenuItem } from '@/components/ui/context-menu/ContextMenuItem';
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
    path: '/tables',
    icon: Table2,
    labelKey: 'tables',
    inMobileMenu: true,
    testId: 'tables-link'
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
    path: '/admin',
    icon: Shield,
    labelKey: 'admin',
    inMobileMenu: true,
    testId: 'admin-link'
  },
  {
    path: '/settings',
    icon: Settings,
    labelKey: 'settings',
    inMobileMenu: true,
    testId: 'settings-link'
  }
];

// Paths that automatically open in a floating window on single click (desktop only)
// Note: Most paths are excluded for now since E2E tests depend on full-page routes
// TODO: Update E2E tests to handle floating windows, then re-enable these paths
const WINDOW_PATHS: Record<string, WindowType> = {
  '/console': 'console',
  '/email': 'email',
  '/chat': 'chat'
};

// Paths that CAN be opened in a window (shown in context menu)
// This is a superset of WINDOW_PATHS - these show "Open in Window" option in context menu
const OPENABLE_IN_WINDOW_PATHS: Record<string, WindowType> = {
  '/notes': 'notes',
  '/console': 'console',
  '/settings': 'settings',
  '/files': 'files',
  '/email': 'email'
};

const canOpenInWindow = (path: string): boolean =>
  path in OPENABLE_IN_WINDOW_PATHS;

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { t } = useTypedTranslation('menu');
  const navigate = useNavigate();
  const location = useLocation();
  const { openWindow } = useWindowManager();
  const [isMobile, setIsMobile] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);

  useEffect(() => {
    // Corresponds to Tailwind's `lg` breakpoint (min-width: 1024px).
    // isMobile is true when screen is smaller than that.
    const mediaQuery = window.matchMedia('(max-width: 1023px)');

    const handleMediaChange = (e: MediaQueryListEvent) =>
      setIsMobile(e.matches);

    // Set initial state and add listener
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleMediaChange);

    // Cleanup on unmount
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, []);

  const handleLaunch = useCallback(
    (path: string) => {
      const windowType = WINDOW_PATHS[path];
      if (windowType && !isMobile) {
        // Open in floating window on desktop if supported
        openWindow(windowType);
      } else {
        // Navigate for mobile or non-window paths
        navigate(path);
      }
      onClose();
    },
    [isMobile, navigate, openWindow, onClose]
  );

  const handleClick = useCallback(
    (path: string) => {
      handleLaunch(path);
    },
    [handleLaunch]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  const handleOpenFromContextMenu = useCallback(() => {
    if (contextMenu) {
      navigate(contextMenu.path);
      onClose();
    }
    setContextMenu(null);
  }, [contextMenu, navigate, onClose]);

  const handleOpenInWindow = useCallback(() => {
    if (contextMenu) {
      const windowType = OPENABLE_IN_WINDOW_PATHS[contextMenu.path];
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
      className={cn(
        'hidden w-64 shrink-0 flex-col border-r bg-background lg:flex',
        isOpen
          ? 'lg:fixed lg:inset-y-0 lg:left-0 lg:z-[60] lg:shadow-lg'
          : 'lg:hidden'
      )}
    >
      <nav className="flex-1 overflow-y-auto p-4">
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
            onClick={handleOpenFromContextMenu}
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
}
