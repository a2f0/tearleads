import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'electron-vite';
import {VitePWA} from 'vite-plugin-pwa';
import packageJson from './package.json';
import {pwaOptions} from './pwa.options';

export default defineConfig({
  main: {
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    build: {
      lib: {
        entry: 'electron/main.ts',
      },
      rollupOptions: {
        external: ['better-sqlite3-multiple-ciphers'],
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: 'electron/preload.ts',
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: './index.html',
      },
    },
    worker: {
      format: 'es',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@rapid/ui/styles.css': path.resolve(__dirname, '../ui/src/styles/index.css'),
        '@rapid/ui/theme.css': path.resolve(__dirname, '../ui/src/styles/theme.css'),
        '@rapid/ui/logo.svg': path.resolve(__dirname, '../ui/src/images/logo.svg'),
        '@rapid/ui': path.resolve(__dirname, '../ui/src/index.ts'),
        '@rapid/api/dist/openapi.json': path.resolve(
          __dirname,
          '../api/dist/openapi.json'
        ),
        '@rapid/classic/package.json': path.resolve(
          __dirname,
          '../classic/package.json'
        ),
        '@rapid/classic': path.resolve(__dirname, '../classic/src/index.ts'),
        '@rapid/calendar/package.json': path.resolve(
          __dirname,
          '../calendar/package.json'
        ),
        '@rapid/calendar': path.resolve(__dirname, '../calendar/src/index.ts'),
        '@rapid/audio/package.json': path.resolve(__dirname, '../audio/package.json'),
        '@rapid/audio': path.resolve(__dirname, '../audio/src/index.ts'),
        '@rapid/email/package.json': path.resolve(__dirname, '../email/package.json'),
        '@rapid/email': path.resolve(__dirname, '../email/src/index.ts'),
        '@rapid/notes/package.json': path.resolve(__dirname, '../notes/package.json'),
        '@rapid/notes': path.resolve(__dirname, '../notes/src/index.ts'),
        '@rapid/mls-chat/package.json': path.resolve(
          __dirname,
          '../mls-chat/package.json'
        ),
        '@rapid/mls-chat': path.resolve(__dirname, '../mls-chat/src/index.ts'),
        '@rapid/vfs-explorer/package.json': path.resolve(
          __dirname,
          '../vfs-explorer/package.json'
        ),
        '@rapid/vfs-explorer': path.resolve(
          __dirname,
          '../vfs-explorer/src/index.ts'
        ),
        '@rapid/window-manager': path.resolve(
          __dirname,
          '../window-manager/src/index.ts'
        ),
      },
    },
    plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  },
});
