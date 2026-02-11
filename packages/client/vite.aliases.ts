import path from 'node:path';

type AliasMap = Record<string, string>;

/**
 * Creates the standard alias configuration for Vite configs.
 * This centralizes aliases shared across vite.config.ts, electron.vite.config.ts,
 * and vitest.config.ts to reduce duplication.
 *
 * @param dirname - The __dirname of the calling config file
 */
export const createViteAliases = (dirname: string): AliasMap => ({
  '@': path.resolve(dirname, './src'),
  '@client': path.resolve(dirname, './src'),
  // UI package - styles, theme, and assets
  '@tearleads/ui/styles.css': path.resolve(dirname, '../ui/src/styles/index.css'),
  '@tearleads/ui/theme.css': path.resolve(dirname, '../ui/src/styles/theme.css'),
  '@tearleads/ui/logo.svg': path.resolve(dirname, '../ui/src/images/logo.svg'),
  '@tearleads/ui': path.resolve(dirname, '../ui/src/index.ts'),
  // API openapi spec
  '@tearleads/api/dist/openapi.json': path.resolve(dirname, '../api/dist/openapi.json'),
  // Workspace packages aliased to source for HMR
  '@tearleads/audio/package.json': path.resolve(dirname, '../audio/package.json'),
  '@tearleads/audio': path.resolve(dirname, '../audio/src/index.ts'),
  '@tearleads/calendar/package.json': path.resolve(dirname, '../calendar/package.json'),
  '@tearleads/calendar': path.resolve(dirname, '../calendar/src/index.ts'),
  '@tearleads/classic/package.json': path.resolve(dirname, '../classic/package.json'),
  '@tearleads/classic': path.resolve(dirname, '../classic/src/index.ts'),
  '@tearleads/contacts/package.json': path.resolve(dirname, '../contacts/package.json'),
  '@tearleads/contacts': path.resolve(dirname, '../contacts/src/index.ts'),
  '@tearleads/email/package.json': path.resolve(dirname, '../email/package.json'),
  '@tearleads/email': path.resolve(dirname, '../email/src/index.ts'),
  '@tearleads/keychain/package.json': path.resolve(
    dirname,
    '../keychain/package.json'
  ),
  '@tearleads/keychain': path.resolve(dirname, '../keychain/src/index.ts'),
  '@tearleads/mls-chat/package.json': path.resolve(dirname, '../mls-chat/package.json'),
  '@tearleads/mls-chat': path.resolve(dirname, '../mls-chat/src/index.ts'),
  '@tearleads/notes/package.json': path.resolve(dirname, '../notes/package.json'),
  '@tearleads/notes': path.resolve(dirname, '../notes/src/index.ts'),
  '@tearleads/terminal/package.json': path.resolve(dirname, '../terminal/package.json'),
  '@tearleads/terminal': path.resolve(dirname, '../terminal/src/index.ts'),
  '@tearleads/vfs-explorer/package.json': path.resolve(dirname, '../vfs-explorer/package.json'),
  '@tearleads/vfs-explorer': path.resolve(dirname, '../vfs-explorer/src/index.ts'),
  '@tearleads/window-manager': path.resolve(dirname, '../window-manager/src/index.ts'),
});
