import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import packageJson from './package.json';
import { pwaOptions } from './pwa.options';

const analyzeBundle = process.env['ANALYZE_BUNDLE'] === 'true';

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
    VitePWA(pwaOptions),
    analyzeBundle &&
      (visualizer({
        filename: 'dist/stats.html',
        open: false,
        gzipSize: true,
        brotliSize: true
      }) as unknown as PluginOption)
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Alias UI package to source for HMR
      '@rapid/ui/styles.css': path.resolve(__dirname, '../ui/src/styles/index.css'),
      '@rapid/ui/theme.css': path.resolve(__dirname, '../ui/src/styles/theme.css'),
      '@rapid/ui/logo.svg': path.resolve(__dirname, '../ui/src/images/logo.svg'),
      '@rapid/audio/package.json': path.resolve(__dirname, '../audio/package.json'),
      '@rapid/audio': path.resolve(__dirname, '../audio/src/index.ts'),
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
      '@rapid/email/package.json': path.resolve(__dirname, '../email/package.json'),
      '@rapid/email': path.resolve(__dirname, '../email/src/index.ts'),
      '@rapid/notes/package.json': path.resolve(__dirname, '../notes/package.json'),
      '@rapid/notes': path.resolve(__dirname, '../notes/src/index.ts'),
      '@rapid/ui': path.resolve(__dirname, '../ui/src/index.ts'),
      '@rapid/vfs-explorer/package.json': path.resolve(
        __dirname,
        '../vfs-explorer/package.json'
      ),
      '@rapid/vfs-explorer': path.resolve(__dirname, '../vfs-explorer/src/index.ts'),
      '@rapid/mls-chat/package.json': path.resolve(
        __dirname,
        '../mls-chat/package.json'
      ),
      '@rapid/mls-chat': path.resolve(__dirname, '../mls-chat/src/index.ts'),
      '@rapid/window-manager': path.resolve(__dirname, '../window-manager/src/index.ts'),
      '@rapid/api/dist/openapi.json': path.resolve(
        __dirname,
        '../api/dist/openapi.json'
      )
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
          'vendor-pdf': ['react-pdf'],
          // Charts (lazy-loaded in analytics)
          'vendor-charts': ['recharts'],
          // Markdown editor (lazy-loaded in notes)
          'vendor-markdown': ['@uiw/react-md-editor']
        }
      }
    }
  }
}));
