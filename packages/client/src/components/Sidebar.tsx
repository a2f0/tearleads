import {
  Archive,
  BarChart3,
  Bot,
  Bug,
  Database,
  FileIcon,
  HardDrive,
  ImageIcon,
  MessageSquare,
  Music,
  Settings,
  Table2,
  Users
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface NavItem {
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  inMobileMenu?: boolean;
  testId?: string;
}

export const navItems: NavItem[] = [
  { path: '/', icon: FileIcon, label: 'Files' },
  {
    path: '/contacts',
    icon: Users,
    label: 'Contacts',
    inMobileMenu: true,
    testId: 'contacts-link'
  },
  { path: '/photos', icon: ImageIcon, label: 'Photos' },
  { path: '/audio', icon: Music, label: 'Audio' },
  {
    path: '/tables',
    icon: Table2,
    label: 'Tables',
    inMobileMenu: true,
    testId: 'tables-link'
  },
  { path: '/analytics', icon: BarChart3, label: 'Analytics' },
  {
    path: '/sqlite',
    icon: Database,
    label: 'SQLite',
    inMobileMenu: true,
    testId: 'sqlite-link'
  },
  {
    path: '/debug',
    icon: Bug,
    label: 'Debug',
    inMobileMenu: true,
    testId: 'debug-link'
  },
  { path: '/opfs', icon: HardDrive, label: 'OPFS' },
  { path: '/cache-storage', icon: Archive, label: 'Cache Storage' },
  { path: '/local-storage', icon: Database, label: 'Local Storage' },
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/models', icon: Bot, label: 'Models' },
  {
    path: '/settings',
    icon: Settings,
    label: 'Settings',
    inMobileMenu: true,
    testId: 'settings-link'
  }
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-background lg:flex">
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
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
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
