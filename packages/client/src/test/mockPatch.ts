import { vi } from 'vitest';

/**
 * Bun 1.3 vi.mock importOriginal polyfill.
 *
 * Problem: Bun doesn't pass `importOriginal` to vi.mock factory functions.
 * When tests use `async (importOriginal) => { const actual = await importOriginal(); ... }`,
 * `importOriginal` is undefined under Bun.
 *
 * Solution: Pre-load commonly mocked modules during preload (before any test
 * file runs). Then wrap vi.mock so that factories expecting importOriginal
 * (factory.length > 0) receive a sync function returning the cached module.
 * The async factory's Promise resolves synchronously (since importOriginal
 * returns a plain object), letting us extract the result via `.then()` in
 * the same microtick and register a sync factory with originalMock.
 */
const isBun =
  typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined';

if (isBun) {
  // Mock virtual modules BEFORE any preloading — transitive imports
  // from workspace packages may reference these Vite virtual modules.
  vi.mock('virtual:app-config', () => ({
    default: {
      id: 'tearleads',
      displayName: 'Tearleads',
      features: [
        'admin',
        'analytics',
        'audio',
        'businesses',
        'calendar',
        'camera',
        'classic',
        'compliance',
        'contacts',
        'email',
        'health',
        'mls-chat',
        'notes',
        'sync',
        'terminal',
        'vehicles',
        'wallet'
      ]
    }
  }));

  const moduleCache = new Map<string, Record<string, unknown>>();

  const modulesToPreload = [
    // External packages
    'react-router-dom',
    '@tearleads/window-manager',
    '@tearleads/app-audio',
    '@tearleads/shared',
    'lucide-react',
    '@tearleads/app-vehicles',
    '@tearleads/ui',
    '@tearleads/api-client/clientEntry',
    '@tearleads/app-admin/clientEntry',
    '@tearleads/app-search',
    '@tearleads/app-keychain/clientEntry',
    '@tearleads/app-health/clientEntry',
    '@tearleads/app-contacts',
    '@tearleads/api-client/authStorage',
    // Internal @/ aliased modules
    '@/components/screensaver',
    '@/components/ui/dropdown-menu',
    '@/contexts/ClientContactsProvider',
    '@/contexts/WindowManagerContext',
    '@/db/adapters',
    '@/db/crypto',
    '@/db/hooks/useHostRuntimeDatabaseState',
    '@/i18n',
    '@/lib/jwt',
    '@/lib/utils',
    '@/lib/vfsItemSyncWriter',
    '@/pages/opfs/OpfsBrowser',
    '@/video/VideoPlaylistContext'
  ];

  for (const mod of modulesToPreload) {
    try {
      const m = await import(mod);
      // Shallow-copy into a plain object to sever ESM live bindings
      const copy: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(m)) {
        copy[key] = m[key];
      }
      moduleCache.set(mod, copy);
    } catch {
      // Module not available — skip
    }
  }

  const originalMock = vi.mock as (
    path: string,
    factory?: (() => unknown) | undefined
  ) => void;

  vi.mock = ((path: string, factoryOrOpts?: unknown): void => {
    if (typeof factoryOrOpts === 'function') {
      const factory = factoryOrOpts as (...args: unknown[]) => unknown;
      if (factory.length > 0) {
        // Factory expects importOriginal — provide cached module
        const cached = moduleCache.get(path) ?? {};
        const importOriginal = () => cached;
        const promise = factory(importOriginal) as Promise<
          Record<string, unknown>
        >;

        // The async factory's only await is on importOriginal() which
        // returns synchronously, so the Promise settles in the same
        // microtick. Extract the result via .then() callback.
        let syncResult: Record<string, unknown> | null = null;
        promise.then((r) => {
          syncResult = r as Record<string, unknown>;
        });

        if (syncResult !== null) {
          originalMock(path, () => syncResult);
        } else {
          // Promise didn't resolve synchronously — register empty mock
          originalMock(path, () => ({}));
        }
        return;
      }
    }
    originalMock(path, factoryOrOpts as (() => unknown) | undefined);
  }) as typeof vi.mock;
}
