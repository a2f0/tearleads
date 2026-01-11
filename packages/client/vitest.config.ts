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
        'src/db/crypto/index.ts',
        'src/db/hooks/index.ts',
        'src/components/ui/footer.tsx'
      ],
      thresholds: {
        statements: 88,
        branches: 80.5,
        functions: 86.8,
        lines: 90.2
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mock pdfjs-dist worker for tests (the ?url suffix is a Vite feature)
      'pdfjs-dist/build/pdf.worker.min.mjs?url':
        path.resolve(__dirname, './src/test/mocks/pdf-worker.ts')
    }
  }
});
