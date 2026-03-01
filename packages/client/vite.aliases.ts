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
    '@admin': path.resolve(dirname, '../admin/src'),
    '@docs': path.resolve(dirname, '../../docs'),
    // UI package - styles, theme, and assets
    '@tearleads/ui/styles.css': path.resolve(
      dirname,
      '../ui/src/styles/index.css'
    ),
    '@tearleads/ui/theme.css': path.resolve(dirname, '../ui/src/styles/theme.css'),
    '@tearleads/ui/logo.svg': path.resolve(dirname, '../ui/src/images/logo.svg'),
    '@tearleads/ui': path.resolve(dirname, '../ui/src/index.ts'),
    '@tearleads/vehicles/package.json': path.resolve(
      dirname,
      '../vehicles/package.json'
    ),
    '@tearleads/vehicles': path.resolve(dirname, '../vehicles/src/index.ts'),
    // Workspace packages aliased to source for HMR
    '@tearleads/admin/package.json': path.resolve(dirname, '../admin/package.json'),
    '@tearleads/admin/clientEntry': path.resolve(
      dirname,
      '../admin/src/clientEntry.ts'
    ),
    '@tearleads/admin': path.resolve(dirname, '../admin/src/index.ts'),
    '@tearleads/analytics/clientEntry': path.resolve(
      dirname,
      '../analytics/src/clientEntry.ts'
    ),
    '@tearleads/audio/package.json': path.resolve(dirname, '../audio/package.json'),
    '@tearleads/audio': path.resolve(dirname, '../audio/src/index.ts'),
    '@tearleads/backups/package.json': path.resolve(
      dirname,
      '../backups/package.json'
    ),
    '@tearleads/backups': path.resolve(dirname, '../backups/src/index.ts'),
    '@tearleads/businesses/package.json': path.resolve(
      dirname,
      '../businesses/package.json'
    ),
    '@tearleads/businesses': path.resolve(dirname, '../businesses/src/index.ts'),
    '@tearleads/calendar/package.json': path.resolve(
      dirname,
      '../calendar/package.json'
    ),
    '@tearleads/calendar': path.resolve(dirname, '../calendar/src/index.ts'),
    '@tearleads/camera/package.json': path.resolve(dirname, '../camera/package.json'),
    '@tearleads/camera': path.resolve(dirname, '../camera/src/index.ts'),
    '@tearleads/classic/package.json': path.resolve(dirname, '../classic/package.json'),
    '@tearleads/classic': path.resolve(dirname, '../classic/src/index.ts'),
    '@tearleads/compliance/package.json': path.resolve(
      dirname,
      '../compliance/package.json'
    ),
    '@tearleads/compliance': path.resolve(dirname, '../compliance/src/index.ts'),
    '@tearleads/contacts/package.json': path.resolve(
      dirname,
      '../contacts/package.json'
    ),
    '@tearleads/contacts': path.resolve(dirname, '../contacts/src/index.ts'),
    '@tearleads/email/package.json': path.resolve(dirname, '../email/package.json'),
    '@tearleads/email': path.resolve(dirname, '../email/src/index.ts'),
    '@tearleads/health/package.json': path.resolve(dirname, '../health/package.json'),
    '@tearleads/health/clientEntry': path.resolve(
      dirname,
      '../health/src/clientEntry.ts'
    ),
    '@tearleads/health': path.resolve(dirname, '../health/src/index.ts'),
    '@tearleads/help/package.json': path.resolve(dirname, '../help/package.json'),
    '@tearleads/help': path.resolve(dirname, '../help/src/index.ts'),
    '@tearleads/local-write-orchestrator/package.json': path.resolve(
      dirname,
      '../local-write-orchestrator/package.json'
    ),
    '@tearleads/local-write-orchestrator': path.resolve(
      dirname,
      '../local-write-orchestrator/src/index.ts'
    ),
    '@tearleads/keychain/package.json': path.resolve(
      dirname,
      '../keychain/package.json'
    ),
    '@tearleads/keychain/clientEntry': path.resolve(
      dirname,
      '../keychain/src/clientEntry.ts'
    ),
    '@tearleads/keychain': path.resolve(dirname, '../keychain/src/index.ts'),
    '@tearleads/wallet/package.json': path.resolve(dirname, '../wallet/package.json'),
    '@tearleads/wallet/clientEntry': path.resolve(
      dirname,
      '../wallet/src/clientEntry.ts'
    ),
    '@tearleads/wallet': path.resolve(dirname, '../wallet/src/index.ts'),
    '@tearleads/mls-core/package.json': path.resolve(
      dirname,
      '../mls-core/package.json'
    ),
    '@tearleads/mls-core': path.resolve(dirname, '../mls-core/src/index.ts'),
    '@tearleads/mls-chat/package.json': path.resolve(
      dirname,
      '../mls-chat/package.json'
    ),
    '@tearleads/mls-chat': path.resolve(dirname, '../mls-chat/src/index.ts'),
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
    '@tearleads/notes/package.json': path.resolve(dirname, '../notes/package.json'),
    '@tearleads/notes': path.resolve(dirname, '../notes/src/index.ts'),
    '@tearleads/notifications/package.json': path.resolve(
      dirname,
      '../notifications/package.json'
    ),
    '@tearleads/notifications/clientEntry': path.resolve(
      dirname,
      '../notifications/src/clientEntry.ts'
    ),
    '@tearleads/notifications/stores': path.resolve(
      dirname,
      '../notifications/src/stores/index.ts'
    ),
    '@tearleads/notifications': path.resolve(dirname, '../notifications/src/index.ts'),
    '@tearleads/search/package.json': path.resolve(
      dirname,
      '../search/package.json'
    ),
    '@tearleads/search': path.resolve(dirname, '../search/src/index.ts'),
    '@tearleads/settings/package.json': path.resolve(
      dirname,
      '../settings/package.json'
    ),
    '@tearleads/settings': path.resolve(dirname, '../settings/src/index.ts'),
    '@tearleads/vfs-sync/package.json': path.resolve(dirname, '../vfs-sync/package.json'),
    '@tearleads/vfs-sync/clientEntry': path.resolve(
      dirname,
      '../vfs-sync/src/clientEntry.ts'
    ),
    '@tearleads/vfs-sync/vfs': path.resolve(dirname, '../vfs-sync/src/vfs/index.ts'),
    '@tearleads/vfs-sync': path.resolve(dirname, '../vfs-sync/src/index.ts'),
    '@tearleads/terminal/package.json': path.resolve(
      dirname,
      '../terminal/package.json'
    ),
    '@tearleads/terminal': path.resolve(dirname, '../terminal/src/index.ts'),
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
    '@tearleads/console/package.json': path.resolve(
      dirname,
      '../console/package.json'
    ),
    '@tearleads/console': path.resolve(dirname, '../console/src/index.ts')
  };

  // Stub aliases come LAST to override base aliases for disabled packages
  return {
    ...baseAliases,
    ...stubAliases
  };
};
