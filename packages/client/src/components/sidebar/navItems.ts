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
  Monitor,
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
  // Core navigation (always visible)
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

  // Feature-gated navigation
  {
    path: '/calendar',
    icon: CalendarDays,
    labelKey: 'calendar',
    inMobileMenu: true,
    testId: 'calendar-link',
    requiredFeature: 'calendar'
  },
  {
    path: '/businesses',
    icon: Building2,
    labelKey: 'businesses',
    inMobileMenu: true,
    testId: 'businesses-link',
    requiredFeature: 'businesses'
  },
  {
    path: '/vehicles',
    icon: CarFront,
    labelKey: 'vehicles',
    inMobileMenu: true,
    testId: 'vehicles-link',
    requiredFeature: 'vehicles'
  },
  {
    path: '/health',
    icon: HeartPulse,
    labelKey: 'health',
    inMobileMenu: true,
    testId: 'health-link',
    requiredFeature: 'health'
  },
  {
    path: '/contacts',
    icon: UsersIcon,
    labelKey: 'contacts',
    inMobileMenu: true,
    testId: 'contacts-link',
    requiredFeature: 'contacts'
  },
  {
    path: '/photos',
    icon: ImageIcon,
    labelKey: 'photos',
    inMobileMenu: true,
    testId: 'photos-link',
    requiredFeature: 'camera'
  },
  {
    path: '/camera',
    icon: Camera,
    labelKey: 'camera',
    inMobileMenu: true,
    testId: 'camera-link',
    requiredFeature: 'camera'
  },
  {
    path: '/documents',
    icon: FileText,
    labelKey: 'documents',
    inMobileMenu: true,
    testId: 'documents-link'
  },

  // Core features (always visible)
  {
    path: '/help',
    icon: CircleHelp,
    labelKey: 'help',
    inMobileMenu: true,
    testId: 'help-link'
  },

  // Feature-gated navigation (continued)
  {
    path: '/notes',
    icon: StickyNote,
    labelKey: 'notes',
    inMobileMenu: true,
    testId: 'notes-link',
    requiredFeature: 'notes'
  },
  {
    path: '/audio',
    icon: Music,
    labelKey: 'audio',
    inMobileMenu: true,
    testId: 'audio-link',
    requiredFeature: 'audio'
  },
  {
    path: '/videos',
    icon: Film,
    labelKey: 'videos',
    inMobileMenu: true,
    testId: 'videos-link',
    requiredFeature: 'audio'
  },
  {
    path: '/analytics',
    icon: BarChart3,
    labelKey: 'analytics',
    inMobileMenu: true,
    testId: 'analytics-link',
    requiredFeature: 'analytics'
  },

  // Core/debug features (always visible)
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
    testId: 'console-link',
    requiredFeature: 'terminal'
  },
  {
    path: '/debug',
    icon: Bug,
    labelKey: 'debug',
    inMobileMenu: true,
    testId: 'debug-link'
  },
  {
    path: '/keychain',
    icon: Key,
    labelKey: 'keychain',
    inMobileMenu: true,
    testId: 'keychain-link'
  },

  // Feature-gated navigation (continued)
  {
    path: '/wallet',
    icon: CreditCard,
    labelKey: 'wallet',
    inMobileMenu: true,
    testId: 'wallet-link',
    requiredFeature: 'wallet'
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
    testId: 'mls-chat-link',
    requiredFeature: 'mls-chat'
  },
  {
    path: '/email',
    icon: Mail,
    labelKey: 'email',
    inMobileMenu: true,
    testId: 'email-link',
    requiredFeature: 'email'
  },
  {
    path: '/models',
    icon: Bot,
    labelKey: 'models',
    inMobileMenu: true,
    testId: 'models-link'
  },

  // Admin features
  {
    path: '/admin',
    icon: Shield,
    labelKey: 'admin',
    inMobileMenu: true,
    testId: 'admin-link',
    requiredFeature: 'admin'
  },
  {
    path: '/admin/users',
    icon: User,
    labelKey: 'adminUsers',
    inMobileMenu: true,
    testId: 'admin-users-link',
    requiredFeature: 'admin'
  },
  {
    path: '/admin/organizations',
    icon: Building2,
    labelKey: 'organizations',
    inMobileMenu: true,
    testId: 'admin-organizations-link',
    requiredFeature: 'admin'
  },

  // Feature-gated navigation (continued)
  {
    path: '/sync',
    icon: RefreshCw,
    labelKey: 'sync',
    inMobileMenu: true,
    testId: 'sync-link',
    requiredFeature: 'sync'
  },

  // Core features (always visible)
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
    testId: 'classic-link',
    requiredFeature: 'classic'
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

export const debugFlyoutItems: AdminFlyoutItem[] = [
  { path: '/debug/system-info', labelKey: 'systemInfo', icon: Monitor },
  {
    path: '/debug/browser/local-storage',
    labelKey: 'localStorage',
    icon: Database
  },
  { path: '/debug/browser/opfs', labelKey: 'opfs', icon: HardDrive },
  {
    path: '/debug/browser/cache-storage',
    labelKey: 'cacheStorage',
    icon: Archive
  }
];
