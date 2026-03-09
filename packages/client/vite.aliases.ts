import path from 'node:path';

type AliasMap = Record<string, string>;

interface ViteAliasOptions {
  /** Packages to stub out (tree-shake). Provided by app-config plugin. */
  disabledPackages?: string[];
}

/**
 * Creates the standard alias configuration for Vite configs.
 * This centralizes aliases shared across vite.config.ts, electron.vite.config.ts,
 * and vitest.config.ts to reduce duplication.
 *
 * @param dirname - The __dirname of the calling config file
 * @param options - Optional configuration
 * @param options.disabledPackages - Packages to stub out for tree-shaking (from app-config plugin)
 */
export const createViteAliases = (
  dirname: string,
  options: ViteAliasOptions = {}
): AliasMap => {
  const disabledPackages = options.disabledPackages ?? [];
  const stubPath = path.resolve(dirname, './src/lib/disabled-package-stub.ts');

  // Create stub aliases for disabled packages
  // These will be spread LAST to override explicit package aliases
  const stubAliases: AliasMap = {};
  for (const pkg of disabledPackages) {
    stubAliases[pkg] = stubPath;
    // Also stub the package.json imports
    stubAliases[`${pkg}/package.json`] = stubPath;
  }

  // Base aliases - explicit package paths for HMR
  const baseAliases: AliasMap = {
    '@': path.resolve(dirname, './src'),
    '@client': path.resolve(dirname, './src'),
    '@admin': path.resolve(dirname, '../app-admin/src'),
    '@docs': path.resolve(dirname, '../../docs'),
    // UI package - styles, theme, and assets
    '@tearleads/ui/styles.css': path.resolve(
      dirname,
      '../ui/src/styles/index.css'
    ),
    '@tearleads/ui/theme.css': path.resolve(dirname, '../ui/src/styles/theme.css'),
    '@tearleads/ui/logo.svg': path.resolve(dirname, '../ui/src/images/logo.svg'),
    '@tearleads/ui': path.resolve(dirname, '../ui/src/index.ts'),
    '@tearleads/app-vehicles/package.json': path.resolve(
      dirname,
      '../app-vehicles/package.json'
    ),
    '@tearleads/app-vehicles/vehiclesDb': path.resolve(
      dirname,
      '../app-vehicles/src/lib/vehiclesDb.ts'
    ),
    '@tearleads/app-vehicles': path.resolve(dirname, '../app-vehicles/src/index.ts'),
    // Workspace packages aliased to source for HMR
    '@tearleads/app-admin/package.json': path.resolve(dirname, '../app-admin/package.json'),
    '@tearleads/app-admin/clientEntry': path.resolve(
      dirname,
      '../app-admin/src/clientEntry.ts'
    ),
    '@tearleads/app-admin': path.resolve(dirname, '../app-admin/src/index.ts'),
    '@tearleads/app-analytics/clientEntry': path.resolve(
      dirname,
      '../app-analytics/src/clientEntry.ts'
    ),
    '@tearleads/app-analytics/analytics': path.resolve(
      dirname,
      '../app-analytics/src/lib/analytics.ts'
    ),
    '@tearleads/app-analytics/analyticsState': path.resolve(
      dirname,
      '../app-analytics/src/lib/analyticsState.ts'
    ),
    '@tearleads/app-audio/package.json': path.resolve(dirname, '../app-audio/package.json'),
    '@tearleads/app-audio': path.resolve(dirname, '../app-audio/src/index.ts'),
    '@tearleads/app-backups/package.json': path.resolve(
      dirname,
      '../app-backups/package.json'
    ),
    '@tearleads/app-backups/format': path.resolve(
      dirname,
      '../app-backups/src/format/index.ts'
    ),
    '@tearleads/app-backups/runtime': path.resolve(
      dirname,
      '../app-backups/src/runtime/index.ts'
    ),
    '@tearleads/app-backups': path.resolve(dirname, '../app-backups/src/index.ts'),
    '@tearleads/app-businesses/package.json': path.resolve(
      dirname,
      '../app-businesses/package.json'
    ),
    '@tearleads/app-businesses': path.resolve(dirname, '../app-businesses/src/index.ts'),
    '@tearleads/app-calendar/package.json': path.resolve(
      dirname,
      '../app-calendar/package.json'
    ),
    '@tearleads/app-calendar': path.resolve(dirname, '../app-calendar/src/index.ts'),
    '@tearleads/app-camera/package.json': path.resolve(dirname, '../app-camera/package.json'),
    '@tearleads/app-camera': path.resolve(dirname, '../app-camera/src/index.ts'),
    '@tearleads/app-classic/package.json': path.resolve(dirname, '../app-classic/package.json'),
    '@tearleads/app-classic': path.resolve(dirname, '../app-classic/src/index.ts'),
    '@tearleads/app-compliance/package.json': path.resolve(
      dirname,
      '../app-compliance/package.json'
    ),
    '@tearleads/app-compliance': path.resolve(dirname, '../app-compliance/src/index.ts'),
    '@tearleads/app-contacts/package.json': path.resolve(
      dirname,
      '../app-contacts/package.json'
    ),
    '@tearleads/app-contacts': path.resolve(dirname, '../app-contacts/src/index.ts'),
    '@tearleads/app-email/package.json': path.resolve(dirname, '../app-email/package.json'),
    '@tearleads/app-email': path.resolve(dirname, '../app-email/src/index.ts'),
    '@tearleads/app-health/package.json': path.resolve(dirname, '../app-health/package.json'),
    '@tearleads/app-health/clientEntry': path.resolve(
      dirname,
      '../app-health/src/clientEntry.ts'
    ),
    '@tearleads/app-health': path.resolve(dirname, '../app-health/src/index.ts'),
    '@tearleads/app-help/package.json': path.resolve(dirname, '../app-help/package.json'),
    '@tearleads/app-help': path.resolve(dirname, '../app-help/src/index.ts'),
    '@tearleads/local-write-orchestrator/package.json': path.resolve(
      dirname,
      '../local-write-orchestrator/package.json'
    ),
    '@tearleads/local-write-orchestrator': path.resolve(
      dirname,
      '../local-write-orchestrator/src/index.ts'
    ),
    '@tearleads/app-keychain/package.json': path.resolve(
      dirname,
      '../app-keychain/package.json'
    ),
    '@tearleads/app-keychain/clientEntry': path.resolve(
      dirname,
      '../app-keychain/src/clientEntry.ts'
    ),
    '@tearleads/app-keychain/keyManager': path.resolve(
      dirname,
      '../app-keychain/src/lib/keyManager.ts'
    ),
    '@tearleads/app-keychain/nativeSecureStorage': path.resolve(
      dirname,
      '../app-keychain/src/lib/nativeSecureStorage.ts'
    ),
    '@tearleads/app-keychain': path.resolve(dirname, '../app-keychain/src/index.ts'),
    '@tearleads/app-wallet/package.json': path.resolve(dirname, '../app-wallet/package.json'),
    '@tearleads/app-wallet/clientEntry': path.resolve(
      dirname,
      '../app-wallet/src/clientEntry.ts'
    ),
    '@tearleads/app-wallet': path.resolve(dirname, '../app-wallet/src/index.ts'),
    '@tearleads/mls-core/package.json': path.resolve(
      dirname,
      '../mls-core/package.json'
    ),
    '@tearleads/mls-core': path.resolve(dirname, '../mls-core/src/index.ts'),
    '@tearleads/app-mls-chat/package.json': path.resolve(
      dirname,
      '../app-mls-chat/package.json'
    ),
    '@tearleads/app-mls-chat': path.resolve(dirname, '../app-mls-chat/src/index.ts'),
    '@tearleads/api-client/clientEntry': path.resolve(
      dirname,
      '../api-client/src/clientEntry.ts'
    ),
    '@tearleads/api-test-utils': path.resolve(
      dirname,
      '../api-test-utils/src/index.ts'
    ),
    '@tearleads/api/lib/postgres': path.resolve(dirname, '../api/src/lib/postgres.ts'),
    '@tearleads/api/lib/redisPubSub': path.resolve(
      dirname,
      '../api/src/lib/redisPubSub.ts'
    ),
    '@tearleads/api/lib/jwt': path.resolve(dirname, '../api/src/lib/jwt.ts'),
    '@tearleads/api/migrations': path.resolve(
      dirname,
      '../api/src/migrations/index.ts'
    ),
    '@tearleads/api': path.resolve(dirname, '../api/src/index.ts'),
    '@tearleads/db/package.json': path.resolve(dirname, '../db/package.json'),
    '@tearleads/db/adapter': path.resolve(dirname, '../db/src/adapter/index.ts'),
    '@tearleads/db/sqlite-migrations': path.resolve(
      dirname,
      '../db/src/sqlite-migrations/index.ts'
    ),
    '@tearleads/db': path.resolve(dirname, '../db/src'),
    '@tearleads/db/sqlite': path.resolve(
      dirname,
      '../db/src/generated/sqlite/schema.ts'
    ),
    '@tearleads/shared/server': path.resolve(
      dirname,
      '../shared/src/server/index.ts'
    ),
    '@tearleads/shared/testing': path.resolve(
      dirname,
      '../shared/src/testing/index.ts'
    ),
    '@tearleads/db/migrations': path.resolve(
      dirname,
      '../db/src/migrations/index.ts'
    ),
    '@tearleads/msw/package.json': path.resolve(dirname, '../msw/package.json'),
    '@tearleads/msw/node': path.resolve(dirname, '../msw/src/node.ts'),
    '@tearleads/msw': path.resolve(dirname, '../msw/src/index.ts'),
    '@tearleads/app-notes/package.json': path.resolve(dirname, '../app-notes/package.json'),
    '@tearleads/app-notes': path.resolve(dirname, '../app-notes/src/index.ts'),
    '@tearleads/app-notifications/package.json': path.resolve(
      dirname,
      '../app-notifications/package.json'
    ),
    '@tearleads/app-notifications/clientEntry': path.resolve(
      dirname,
      '../app-notifications/src/clientEntry.ts'
    ),
    '@tearleads/app-notifications/stores': path.resolve(
      dirname,
      '../app-notifications/src/stores/index.ts'
    ),
    '@tearleads/app-notifications': path.resolve(dirname, '../app-notifications/src/index.ts'),
    '@tearleads/app-search/package.json': path.resolve(
      dirname,
      '../app-search/package.json'
    ),
    '@tearleads/app-search': path.resolve(dirname, '../app-search/src/index.ts'),
    '@tearleads/app-settings/package.json': path.resolve(
      dirname,
      '../app-settings/package.json'
    ),
    '@tearleads/app-settings': path.resolve(dirname, '../app-settings/src/index.ts'),
    '@tearleads/vfs-sync/package.json': path.resolve(dirname, '../vfs-sync/package.json'),
    '@tearleads/vfs-sync/clientEntry': path.resolve(
      dirname,
      '../vfs-sync/src/clientEntry.ts'
    ),
    '@tearleads/vfs-sync/vfs': path.resolve(dirname, '../vfs-sync/src/vfs/index.ts'),
    '@tearleads/vfs-sync': path.resolve(dirname, '../vfs-sync/src/index.ts'),
    '@tearleads/app-terminal/package.json': path.resolve(
      dirname,
      '../app-terminal/package.json'
    ),
    '@tearleads/app-terminal': path.resolve(dirname, '../app-terminal/src/index.ts'),
    '@tearleads/vfs-explorer/package.json': path.resolve(
      dirname,
      '../vfs-explorer/package.json'
    ),
    '@tearleads/vfs-explorer': path.resolve(
      dirname,
      '../vfs-explorer/src/index.ts'
    ),
    '@tearleads/window-manager': path.resolve(
      dirname,
      '../window-manager/src/index.ts'
    ),
  };

  // Stub aliases come LAST to override base aliases for disabled packages
  return {
    ...baseAliases,
    ...stubAliases
  };
};
