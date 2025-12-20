import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig, externalizeDepsPlugin} from 'electron-vite';
import packageJson from './package.json';

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: 'electron/main.ts',
      },
    },
    plugins: [externalizeDepsPlugin()],
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
    plugins: [externalizeDepsPlugin()],
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@rapid/ui/styles.css': path.resolve(__dirname, '../ui/src/styles/index.css'),
        '@rapid/ui/theme.css': path.resolve(__dirname, '../ui/src/styles/theme.css'),
        '@rapid/ui/logo.svg': path.resolve(__dirname, '../ui/src/images/logo.svg'),
        '@rapid/ui': path.resolve(__dirname, '../ui/src/index.ts'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
