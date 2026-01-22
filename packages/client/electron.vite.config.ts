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
      },
    },
    plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  },
});
