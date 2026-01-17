import {
  Archive,
  BarChart3,
  Bot,
  Bug,
  Database,
  FileIcon,
  FileText,
  Film,
  HardDrive,
  Home,
  ImageIcon,
  Key,
  MessageSquare,
  Music,
  Settings,
  Shield,
  StickyNote,
  Table2,
  Terminal,
  Users
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
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

export interface SidebarProps {
  isOpen: boolean;
}

export function Sidebar({ isOpen }: SidebarProps) {
  const { t } = useTypedTranslation('menu');

  return (
    <aside
      id="sidebar"
      className={cn(
        'hidden w-64 shrink-0 flex-col border-r bg-background lg:flex',
        isOpen
          ? 'lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:shadow-lg'
          : 'lg:hidden'
      )}
    >
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  data-testid={item.testId}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 font-medium text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )
                  }
                >
                  <Icon className="h-5 w-5" />
                  {t(item.labelKey)}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
