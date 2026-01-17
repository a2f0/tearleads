import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Include both unit tests and integration tests.
    // Integration tests use SQLite WASM (no native module compilation needed).
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.integration.test.{ts,tsx}'],
    exclude: ['tests/**/*', 'node_modules/**/*'],
    // Increase timeout for integration tests that use WASM-based SQLite
    // Default is 5000ms, but integration tests need more time for database setup
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.integration.test.{ts,tsx}',
        'src/test/**/*',
        'src/types/**/*',
        'src/main.tsx',
        'src/vite-env.d.ts',
        // LLM files are excluded because they rely on web workers and WebGPU
        // which require integration/e2e testing rather than unit tests
        'src/hooks/useLLM.ts',
        'src/lib/llm-runtime.ts',
        'src/workers/llm-worker.ts',
        // Browser-specific APIs that cannot be tested in jsdom:
        // - OPFS (Origin Private File System) for encrypted file storage
        // - Canvas/createImageBitmap for image thumbnail generation
        // - useDatabase hook orchestrates multiple browser APIs (IndexedDB, OPFS)
        'src/db/hooks/useDatabase.tsx',
        'src/lib/thumbnail.ts',
        'src/storage/opfs.ts',
        // SQLite worker files require web worker environment and WASM runtime
        // that cannot be tested in jsdom
        'src/workers/sqlite.worker.interface.ts',
        'src/workers/sqlite.worker.ts',
        // Platform-specific adapters require their native runtime environments
        // (Capacitor for mobile, Electron for desktop, Web for browser OPFS)
        'src/db/adapters/capacitor.adapter.ts',
        'src/db/adapters/electron.adapter.ts',
        'src/db/adapters/web.adapter.ts',
        // Native secure storage requires Capacitor native biometric APIs
        'src/db/crypto/native-secure-storage.ts',
        // Barrel files that only re-export from other modules
        // (footer.tsx re-exports Footer from @rapid/ui package)
        'src/audio/index.ts',
        'src/components/contacts/column-mapper/index.ts',
        'src/components/duration-chart/index.ts',
        'src/components/hud/index.ts',
        'src/components/pdf/index.ts',
        'src/components/settings/index.ts',
        'src/components/ui/back-link/index.ts',
        'src/components/ui/bottom-sheet/index.ts',
        'src/components/ui/card/index.ts',
        'src/components/ui/context-menu/index.ts',
        'src/components/ui/editable-title/index.ts',
        'src/db/crypto/index.ts',
        'src/db/hooks/index.ts',
        'src/db/schema/index.ts',
        'src/components/ui/footer.tsx',
        'src/components/ui/grid-square/index.ts',
        'src/i18n/index.ts',
        'src/pages/admin/index.ts',
        'src/pages/analytics/index.ts',
        'src/pages/cache-storage/index.ts',
        'src/pages/chat/index.ts',
        'src/pages/contacts/index.ts',
        'src/pages/debug/index.ts',
        'src/pages/keychain/index.ts',
        'src/pages/local-storage/index.ts',
        'src/pages/models/index.ts',
        'src/pages/opfs/index.ts',
        'src/sse/index.ts',
        'src/video/index.ts',
        'src/components/console-window/index.ts',
        'src/components/floating-window/index.ts',
        'src/components/notes-window/index.ts',
        'src/components/window-renderer/index.ts',
        'src/pages/console/index.ts',
        'src/pages/console/components/index.ts',
        'src/pages/console/hooks/index.ts',
        'src/pages/console/lib/index.ts',
        // Type-only modules with no runtime behavior
        'src/components/contacts/column-mapper/types.ts',
        'src/db/migrations/types.ts',
        'src/i18n/translations/types.ts',
        'src/pages/opfs/types.ts',
        // Test infrastructure for Playwright parallel execution
        'src/lib/test-instance.ts'
      ],
      thresholds: {
        statements: 93.9,
        branches: 85.8,
        functions: 94.9,
        lines: 95.4
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
