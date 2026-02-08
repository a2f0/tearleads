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
  // UI package - styles, theme, and assets
  '@rapid/ui/styles.css': path.resolve(dirname, '../ui/src/styles/index.css'),
  '@rapid/ui/theme.css': path.resolve(dirname, '../ui/src/styles/theme.css'),
  '@rapid/ui/logo.svg': path.resolve(dirname, '../ui/src/images/logo.svg'),
  '@rapid/ui': path.resolve(dirname, '../ui/src/index.ts'),
  // API openapi spec
  '@rapid/api/dist/openapi.json': path.resolve(dirname, '../api/dist/openapi.json'),
  // Workspace packages aliased to source for HMR
  '@rapid/audio/package.json': path.resolve(dirname, '../audio/package.json'),
  '@rapid/audio': path.resolve(dirname, '../audio/src/index.ts'),
  '@rapid/calendar/package.json': path.resolve(dirname, '../calendar/package.json'),
  '@rapid/calendar': path.resolve(dirname, '../calendar/src/index.ts'),
  '@rapid/classic/package.json': path.resolve(dirname, '../classic/package.json'),
  '@rapid/classic': path.resolve(dirname, '../classic/src/index.ts'),
  '@rapid/contacts/package.json': path.resolve(dirname, '../contacts/package.json'),
  '@rapid/contacts': path.resolve(dirname, '../contacts/src/index.ts'),
  '@rapid/email/package.json': path.resolve(dirname, '../email/package.json'),
  '@rapid/email': path.resolve(dirname, '../email/src/index.ts'),
  '@rapid/mls-chat/package.json': path.resolve(dirname, '../mls-chat/package.json'),
  '@rapid/mls-chat': path.resolve(dirname, '../mls-chat/src/index.ts'),
  '@rapid/notes/package.json': path.resolve(dirname, '../notes/package.json'),
  '@rapid/notes': path.resolve(dirname, '../notes/src/index.ts'),
  '@rapid/vfs-explorer/package.json': path.resolve(dirname, '../vfs-explorer/package.json'),
  '@rapid/vfs-explorer': path.resolve(dirname, '../vfs-explorer/src/index.ts'),
  '@rapid/window-manager': path.resolve(dirname, '../window-manager/src/index.ts'),
});
