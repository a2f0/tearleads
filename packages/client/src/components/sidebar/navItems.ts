import {
  AppWindow,
  Archive,
  BarChart3,
  Bot,
  Bug,
  Building2,
  CalendarDays,
  Camera,
  CarFront,
  CircleHelp,
  CreditCard,
  Database,
  FileIcon,
  FileText,
  Film,
  FolderTree,
  HardDrive,
  HeartPulse,
  Home,
  ImageIcon,
  Key,
  Lock,
  Mail,
  MessageSquare,
  Music,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  StickyNote,
  Terminal,
  User,
  Users as UsersIcon
} from 'lucide-react';
import type { AdminFlyoutItem, NavItem } from './types';

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
    path: '/search',
    icon: Search,
    labelKey: 'search',
    inMobileMenu: true,
    testId: 'search-link'
  },
  {
    path: '/calendar',
    icon: CalendarDays,
    labelKey: 'calendar',
    inMobileMenu: true,
    testId: 'calendar-link'
  },
  {
    path: '/businesses',
    icon: Building2,
    labelKey: 'businesses',
    inMobileMenu: true,
    testId: 'businesses-link'
  },
  {
    path: '/vehicles',
    icon: CarFront,
    labelKey: 'vehicles',
    inMobileMenu: true,
    testId: 'vehicles-link'
  },
  {
    path: '/health',
    icon: HeartPulse,
    labelKey: 'health',
    inMobileMenu: true,
    testId: 'health-link'
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
    path: '/camera',
    icon: Camera,
    labelKey: 'camera',
    inMobileMenu: true,
    testId: 'camera-link'
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
    path: '/wallet',
    icon: CreditCard,
    labelKey: 'wallet',
    inMobileMenu: true,
    testId: 'wallet-link'
  },
  {
    path: '/ai',
    icon: MessageSquare,
    labelKey: 'chat',
    inMobileMenu: true,
    testId: 'ai-link'
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
    path: '/vfs',
    icon: FolderTree,
    labelKey: 'vfs',
    inMobileMenu: true,
    testId: 'vfs-link'
  },
  {
    path: '/classic',
    icon: AppWindow,
    labelKey: 'classic',
    inMobileMenu: true,
    testId: 'classic-link'
  },
  {
    path: '/backups',
    icon: Save,
    labelKey: 'backups',
    inMobileMenu: true,
    testId: 'backups-link'
  },
  {
    path: '/settings',
    icon: Settings,
    labelKey: 'settings',
    inMobileMenu: true,
    testId: 'settings-link'
  }
];

export const adminFlyoutItems: AdminFlyoutItem[] = [
  { path: '/admin/redis', labelKey: 'redis', icon: Database },
  { path: '/admin/postgres', labelKey: 'postgres', icon: Database },
  { path: '/admin/groups', labelKey: 'groups', icon: UsersIcon },
  { path: '/admin/organizations', labelKey: 'organizations', icon: Building2 },
  { path: '/admin/users', labelKey: 'adminUsers', icon: User }
];
