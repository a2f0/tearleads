import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json';
import { pwaOptions } from './pwa.options';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA(pwaOptions)
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Alias UI package to source for HMR
      '@rapid/ui/styles.css': path.resolve(__dirname, '../ui/src/styles/index.css'),
      '@rapid/ui/theme.css': path.resolve(__dirname, '../ui/src/styles/theme.css'),
      '@rapid/ui/logo.svg': path.resolve(__dirname, '../ui/src/images/logo.svg'),
      '@rapid/ui': path.resolve(__dirname, '../ui/src/index.ts')
    }
  },
  clearScreen: false,
  server: {
    port: 3000,
    headers: {
      // Required for SharedArrayBuffer (used by some WASM implementations)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    // Don't pre-bundle WASM modules - they need special handling
    exclude: ['@/workers/sqlite-wasm']
  },
  assetsInclude: ['**/*.wasm']
});
