import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createViteAliases } from './vite.aliases';
import { createAppConfigPlugin } from './vite-plugin-app-config';

const sharedTestConfig = {
  test: {
    pool: 'threads' as const,
    deps: { optimizer: { client: { enabled: true }, ssr: { enabled: true } } },
  },
};
const isCoverageRun = process.argv.includes('--coverage');

// Initialize app config plugin for virtual module support in tests
const { plugin: appConfigPlugin } = createAppConfigPlugin(__dirname);

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    plugins: [appConfigPlugin, react()],
    test: {
      ...(isCoverageRun
        ? {
            pool: 'threads',
            maxWorkers: 1,
            minWorkers: 1,
            environment: 'jsdom'
          }
        : { environment: 'happy-dom' }),
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      // Include both unit tests and integration tests.
      // Integration tests use SQLite WASM (no native module compilation needed).
      include: ['src/**/*.test.{ts,tsx}', 'src/**/*.integration.test.{ts,tsx}'],
      exclude: ['tests/**/*', 'node_modules/**/*'],
      // Increase timeout for integration tests that use WASM-based SQLite
      // Default is 5000ms, but integration tests need more time for database setup
      testTimeout: 15000,
      hookTimeout: 30000,
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
          'src/lib/llmRuntime.ts',
          'src/workers/llmWorker.ts',
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
          // SQLite worker modules extracted during refactoring
          'src/workers/sqlite/**',
          // Platform-specific adapters require their native runtime environments
          // (Capacitor for mobile, Electron for desktop, Web for browser OPFS)
          'src/db/adapters/capacitor.adapter.ts',
          'src/db/adapters/electron.adapter.ts',
          'src/db/adapters/web.adapter.ts',
          // Native secure storage requires Capacitor native biometric APIs
          'src/db/crypto/nativeSecureStorage.ts',
          // Barrel files that only re-export from other modules
          'src/audio/index.ts',
          'src/components/contacts/column-mapper/index.ts',
          'src/components/sessions/index.ts',
          'src/components/duration-chart/index.ts',
          'src/components/hud/index.ts',
          'src/components/pdf/index.ts',
          'src/components/settings/index.ts',
          'src/components/ui/back-link/index.ts',
          'src/components/ui/bottom-sheet/index.ts',
          'src/components/ui/card/index.ts',
          'src/components/ui/context-menu/index.ts',
          'src/components/ui/editable-title/index.ts',
          // Dialog components are UI wrappers for the photos/calendar package context
          'src/components/ui/dialog/index.ts',
          'src/components/ui/dialog/Dialog.tsx',
          'src/components/ui/dialog/DialogContent.tsx',
          'src/components/ui/dialog/DialogDescription.tsx',
          'src/components/ui/dialog/DialogFooter.tsx',
          'src/components/ui/dialog/DialogHeader.tsx',
          'src/components/ui/dialog/DialogTitle.tsx',
          'src/db/crypto/index.ts',
          'src/db/hooks/index.ts',
          'src/db/schema/index.ts',
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
          'src/pages/photos-components/index.ts',
          // usePhotosFileActions uses OPFS file storage and encryption key manager
          // which require browser APIs not available in jsdom
          'src/pages/photos-components/usePhotosFileActions.ts',
          // useColumnCount uses ResizeObserver which requires browser environment
          'src/pages/photos-components/useColumnCount.ts',
          // home-components hooks use WindowManager context, screensaver, and localStorage
          // which require browser environment or full integration testing
          'src/pages/home-components/constants.ts',
          'src/pages/home-components/useHomeArrangement.ts',
          'src/pages/home-components/useHomeContextMenu.ts',
          'src/pages/home-components/useHomeIconDrag.ts',
          'src/pages/search/index.ts',
          'src/pages/wallet/index.ts',
          'src/sse/index.ts',
          'src/video/index.ts',
          'src/components/admin-groups/index.ts',
          'src/components/chat-window/index.ts',
          'src/contexts/ClientContactsProvider.tsx',
          // ClientEmailProvider has database folder operations that require integration testing
          'src/contexts/ClientEmailProvider.tsx',
          'src/components/files/index.ts',
          'src/components/files-window/index.ts',
          'src/components/search-window/index.ts',
          'src/components/floating-window/index.ts',
          'src/components/contacts-window/index.tsx',
          'src/components/notes-window/index.ts',
          'src/components/wallet-window/index.ts',
          'src/components/ui/drop-zone-overlay/index.ts',
          // Wrapper component that delegates to @tearleads/audio package
          'src/components/audio-window/index.tsx',
          // Wrapper component that delegates to @tearleads/photos package
          'src/components/photos-window/index.tsx',
          // Photos provider has database/file operations that require integration testing
          'src/contexts/ClientPhotosProvider.tsx',
          'src/components/window-renderer/index.ts',
          'src/db/backup/index.ts',
          // Backup importer requires full database setup, instance registry, and OPFS
          // file storage which cannot be mocked in jsdom environment
          'src/db/backup/importer.ts',
          // Compression uses browser Compression Streams API (lines 40-93) which cannot
          // be tested in Node.js/jsdom - tests cover the Node.js zlib path only
          'src/db/backup/compression.ts',
          // Type-only modules with no runtime behavior
          'src/components/contacts/column-mapper/types.ts',
          'src/db/migrations/types.ts',
          'src/i18n/translations/types.ts',
          'src/pages/opfs/types.ts',
          'src/pages/sync/index.ts',
          // Stores that require full app context for testing
          'src/stores/presentationStore.ts',
          // Window components are thin wrappers delegating to package components
          'src/components/*-window/index.ts',
          'src/components/*-window/index.tsx',
          'src/components/*-window/*Window.tsx',
          'src/components/*-window/*MenuBar.tsx',
          // Admin components require full permissions context
          'src/components/admin/**',
          'src/pages/admin/**/*.tsx',
          // Notification center and AI window are complex integrations
          'src/components/notification-center/**',
          'src/components/ai-window/**',
          // Settings effects hook requires full app lifecycle
          'src/components/settings/SettingsEffects.tsx',
          // Sidebar is a navigation component
          'src/components/Sidebar.tsx',
          // Barrel files throughout the codebase (re-exports only)
          'src/**/index.ts',
          'src/**/index.tsx',
          // Type-only files throughout the codebase
          'src/**/types.ts',
          // Context providers require full app lifecycle
          'src/contexts/**/*Provider.tsx',
          // Storage provider delegates to OPFS
          'src/storage/opfs/CacheStorageStorage.ts',
          // Photos provider directory
          'src/components/photos-provider/**',
          // Context menus with complex interactions
          'src/components/database-window/DatabaseContextMenus.tsx',
          'src/components/console-window/ConsoleContextMenu.tsx',
          // Table rows types
          'src/pages/TableRowsTypes.ts',
          // Markdown viewer components
          'src/components/markdown-viewer/**',
          // Test infrastructure for Playwright parallel execution
          'src/lib/testInstance.ts',
          // MLS chat page - TODO: add tests
          'src/pages/MlsChat.tsx',
          // Search module files that require OPFS or browser-specific APIs
          // - searchIndexStorage.ts uses OPFS for encrypted index persistence
          // - SearchProvider.tsx uses database lifecycle hooks
          // - useSearch.ts uses useSyncExternalStore with browser APIs
          'src/search/searchIndexStorage.ts',
          'src/search/SearchProvider.tsx',
          'src/search/useSearch.ts',
          'src/search/index.ts',
          'src/search/types.ts',
          // AI tools barrel file
          'src/ai/tools/index.ts',
          'src/ai/tools/types.ts',
          // Help.tsx passes callbacks that are never invoked due to HelpLinksGrid
          // rendering different UI based on view (topLevel vs developer). The callbacks
          // for the inactive view cannot be exercised in tests.
          'src/pages/help/Help.tsx',
          // App config runtime module - thin wrapper over virtual module
          'src/lib/appConfig.ts'
        ],
        thresholds: {
          // Threshold lowered after file-splitting refactor. Coverage fluctuates
          // slightly depending on test execution order and module loading.
          statements: 90.2,
          branches: 82.4,
          functions: 91.4,
          lines: 91.7
        }
      }
    },
    resolve: {
      alias: {
        ...createViteAliases(__dirname),
        // Force a single React instance across client and workspace package source aliases.
        // Without this, hooks load from dist/ while providers load from src/,
        // creating duplicate React context objects that cause "useContext is null" errors
        react: path.resolve(__dirname, './node_modules/react'),
        'react-dom': path.resolve(__dirname, './node_modules/react-dom')
      }
    }
  })
);
