import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json';
import { pwaOptions } from './pwa.options';

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    // Default API URL for development mode
    ...(mode === 'development' && {
      'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:5001/v1')
    })
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
    strictPort: true,
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
  assetsInclude: ['**/*.wasm'],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React dependencies
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Chat/AI dependencies (only used in Chat page)
          'vendor-chat': ['@assistant-ui/react'],
          // Database dependencies
          'vendor-db': ['drizzle-orm'],
          // UI dependencies
          'vendor-ui': ['lucide-react', 'class-variance-authority'],
          // PDF viewer (lazy-loaded when viewing documents)
          'vendor-pdf': ['react-pdf']
        }
      }
    }
  }
}));
