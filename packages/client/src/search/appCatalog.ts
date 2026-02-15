import type { SearchableDocument } from '@tearleads/search';
import type { WindowType } from '@/contexts/WindowManagerContext';

interface SearchableAppDefinition {
  windowType: WindowType;
  path: string;
  title: string;
  keywords?: string[];
}

const SEARCHABLE_APPS: SearchableAppDefinition[] = [
  { windowType: 'notes', path: '/notes', title: 'Notes' },
  { windowType: 'console', path: '/console', title: 'Console' },
  { windowType: 'settings', path: '/settings', title: 'Settings' },
  { windowType: 'files', path: '/files', title: 'Files' },
  {
    windowType: 'tables',
    path: '/tables',
    title: 'Tables',
    keywords: ['database']
  },
  { windowType: 'debug', path: '/debug', title: 'Debug' },
  { windowType: 'help', path: '/help', title: 'Help' },
  { windowType: 'documents', path: '/documents', title: 'Documents' },
  { windowType: 'email', path: '/email', title: 'Email' },
  { windowType: 'contacts', path: '/contacts', title: 'Contacts' },
  { windowType: 'photos', path: '/photos', title: 'Photos' },
  {
    windowType: 'camera',
    path: '/camera',
    title: 'Camera',
    keywords: ['capture', 'webcam', 'scan']
  },
  { windowType: 'videos', path: '/videos', title: 'Videos' },
  { windowType: 'keychain', path: '/keychain', title: 'Keychain' },
  {
    windowType: 'wallet',
    path: '/wallet',
    title: 'Wallet',
    keywords: ['passport', 'license', 'credit card', 'identity']
  },
  { windowType: 'sqlite', path: '/sqlite', title: 'SQLite' },
  { windowType: 'opfs', path: '/debug/browser/opfs', title: 'OPFS' },
  { windowType: 'ai', path: '/ai', title: 'AI', keywords: ['chat'] },
  { windowType: 'analytics', path: '/analytics', title: 'Analytics' },
  { windowType: 'audio', path: '/audio', title: 'Audio', keywords: ['music'] },
  { windowType: 'models', path: '/models', title: 'Models', keywords: ['ai'] },
  { windowType: 'admin', path: '/admin', title: 'Admin' },
  {
    windowType: 'admin-redis',
    path: '/admin/redis',
    title: 'Redis',
    keywords: ['admin']
  },
  {
    windowType: 'admin-postgres',
    path: '/admin/postgres',
    title: 'Postgres',
    keywords: ['admin', 'postgresql']
  },
  {
    windowType: 'admin-groups',
    path: '/admin/groups',
    title: 'Groups',
    keywords: ['admin']
  },
  {
    windowType: 'admin-users',
    path: '/admin/users',
    title: 'Users Admin',
    keywords: ['admin']
  },
  {
    windowType: 'admin-organizations',
    path: '/admin/organizations',
    title: 'Organizations Admin',
    keywords: ['admin']
  },
  {
    windowType: 'cache-storage',
    path: '/debug/browser/cache-storage',
    title: 'Cache Storage'
  },
  {
    windowType: 'local-storage',
    path: '/debug/browser/local-storage',
    title: 'Local Storage'
  },
  { windowType: 'sync', path: '/sync', title: 'Sync' },
  { windowType: 'vfs', path: '/vfs', title: 'VFS Explorer' },
  { windowType: 'classic', path: '/classic', title: 'Classic' },
  { windowType: 'backup', path: '/backups', title: 'Backups' },
  { windowType: 'mls-chat', path: '/mls-chat', title: 'MLS Chat' },
  { windowType: 'search', path: '/search', title: 'Search' },
  { windowType: 'calendar', path: '/calendar', title: 'Calendar' },
  { windowType: 'vehicles', path: '/vehicles', title: 'Vehicles' },
  { windowType: 'health', path: '/health', title: 'Health' }
];

const APP_ID_PREFIX = 'app:';

export function toAppSearchId(windowType: WindowType): string {
  return `${APP_ID_PREFIX}${windowType}`;
}

const APP_BY_ID = new Map(
  SEARCHABLE_APPS.map((app) => [toAppSearchId(app.windowType), app] as const)
);

export function getSearchableAppById(
  id: string
): SearchableAppDefinition | null {
  return APP_BY_ID.get(id) ?? null;
}

export function createSearchableAppDocuments(
  now = Date.now()
): SearchableDocument[] {
  return SEARCHABLE_APPS.map((app) => {
    const metadataParts = [app.path, app.windowType];
    if (app.keywords && app.keywords.length > 0) {
      metadataParts.push(...app.keywords);
    }

    return {
      id: toAppSearchId(app.windowType),
      entityType: 'app',
      title: app.title,
      metadata: metadataParts.join(' '),
      createdAt: now,
      updatedAt: now
    };
  });
}
