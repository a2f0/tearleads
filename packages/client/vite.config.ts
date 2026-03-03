import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import packageJson from './package.json';
import { pwaOptions } from './pwa.options';
import { createViteAliases } from './vite.aliases';
import { createAppConfigPlugin } from './vite-plugin-app-config';
import { wasmGeneratedGuard } from './vite-plugin-wasm-generated';

const analyzeBundle = process.env['ANALYZE_BUNDLE'] === 'true';

// Initialize app config plugin - handles disabled packages via resolveId hook
const { plugin: appConfigPlugin } = createAppConfigPlugin(__dirname);

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    // Default API URL for development mode
    ...(mode === 'development' && {
      'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:3000/v1')
    })
  },
  plugins: [
    wasmGeneratedGuard(),
    appConfigPlugin,
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
    // Note: disabled packages are now handled by appConfigPlugin via resolveId
    alias: createViteAliases(__dirname)
  },
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
    headers: {
      // Required for SharedArrayBuffer (used by some WASM implementations)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    proxy: {
      '/v1': {
        target: 'http://localhost:5001',
        changeOrigin: true
      },
      '/v2': {
        target: 'http://localhost:5002',
        changeOrigin: true
      }
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
    // Known optional/lazy chunks (markdown editor + syntax/highlight graph libs)
    // legitimately exceed Vite's default 500 kB warning threshold.
    // Keep a higher threshold so warnings signal real regressions.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React dependencies
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Chat/AI dependencies (only used in Chat page)
          'vendor-chat': ['@assistant-ui/react'],
          // Database dependencies
          'vendor-db': ['drizzle-orm'],
          // UI dependencies (lucide-react removed - bundled with code that uses it to avoid chunk loading issues)
          'vendor-ui': ['class-variance-authority'],
          // PDF viewer (lazy-loaded when viewing documents)
          'vendor-pdf': ['react-pdf'],
          // Markdown editor (lazy-loaded in notes)
          'vendor-markdown': ['@uiw/react-md-editor'],
          // Mermaid diagrams (lazy-loaded when viewing markdown with diagrams)
          'vendor-mermaid': ['mermaid']
        }
      }
    }
  }
}));
