import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  $schema: './node_modules/knip/schema.json',
  include: [
    'binaries',
    'catalog',
    'classMembers',
    'dependencies',
    'devDependencies',
    'duplicates',
    'enumMembers',
    'exports',
    'files',
    'nsExports',
    'nsTypes',
    'types',
    'unlisted',
    'unresolved'
  ],
  ignoreBinaries: ['ansible-lint', 'shellcheck', 'playwright'],
  ignoreIssues: {
    // Consumed from source across package boundaries (admin/client split) via path aliases.
    'packages/client/src/lib/utils.ts': ['exports'],
    // Imported as a type-only contract by admin package via client alias.
    'packages/client/src/i18n/translations/types.ts': ['types'],
    // Exported interface appears in an inferred cross-module public return type.
    'packages/vfs-explorer/src/hooks/useVfsAllItems.ts': ['types'],
    // Canonical DB schema pieces intentionally re-exported across definition modules.
    'packages/db/src/schema/definition-communications-vfs.ts': ['exports'],
    // Exported return type for public getBlob API needed for .d.ts generation.
    'packages/api-client/src/apiRoutes/vfsRoutes.ts': ['types'],
    // Exported interfaces are part of public signatures for published helpers.
    'packages/api/src/lib/vfsSyncChannels.ts': ['exports', 'types'],
    'packages/bob-and-alice/src/qa/vfsSecureUploadQaSuite.ts': ['types'],
    // Class members are part of exported runtime/test harness APIs.
    'packages/api-client/src/vfsBlobNetworkFlusher.ts': ['classMembers'],
    'packages/api-client/src/vfsNetworkFlusher.ts': ['classMembers'],
    'packages/api-client/src/vfsWriteOrchestrator.ts': ['classMembers'],
    'packages/bob-and-alice/src/harness/actorHarness.ts': ['classMembers'],
    'packages/bob-and-alice/src/harness/apiScenarioHarness.ts': [
      'classMembers'
    ],
    'packages/bob-and-alice/src/harness/scenarioHarness.ts': ['classMembers'],
    'packages/bob-and-alice/src/harness/serverHarness.ts': ['classMembers'],
    'packages/client/src/components/ui/ErrorBoundary.tsx': ['classMembers'],
    'packages/client/src/db/adapters/web.adapter.ts': ['classMembers'],
    'packages/mls-chat/src/lib/mls.ts': ['classMembers'],
    'packages/mls-chat/src/lib/storage.ts': ['classMembers'],
    'packages/vfs-sync/src/vfs/access/sync-access-harness.ts': [
      'classMembers'
    ],
    'packages/vfs-sync/src/vfs/blob/sync-blob-commit.ts': ['classMembers'],
    'packages/vfs-sync/src/vfs/blob/sync-blob-isolation.ts': ['classMembers'],
    'packages/vfs-sync/src/vfs/client/sync-client-utils.ts': ['classMembers'],
    'packages/vfs-sync/src/vfs/client/sync-client.ts': ['classMembers'],
    'packages/vfs-sync/src/vfs/protocol/sync-crdt-types.ts': ['classMembers']
  },
  workspaces: {
    '.': {
      entry: [
        'scripts/*.ts',
        'scripts/agents/**/*.ts',
        'scripts/ciImpact/**/*.ts',
        'scripts/costModel/**/*.ts',
        'scripts/lib/**/*.ts',
        'scripts/preen/**/*.ts',
        'scripts/tooling/scriptTool.ts'
      ],
      ignoreDependencies: [
        // Invoked via scripts/checks/checkDependencyCruiser.sh.
        'dependency-cruiser'
      ]
    },
    'packages/app-builder': {
      entry: ['apps/*/config.ts']
    },
    'packages/api': {
      entry: ['src/openapi.ts']
    },
    'packages/api-test-utils': {
      entry: ['src/**/*.test.ts']
    },
    'packages/db-test-utils': {
      entry: ['src/**/*.test.ts', 'src/**/*.test.tsx']
    },
    'packages/client': {
      entry: [
        'electron.vite.config.ts',
        'electron-builder.config.ts',
        'electron/main.ts',
        'electron/preload.ts'
      ],
      ignoreDependencies: [
        // CLI tool used by electron-builder rebuild scripts, not imported in source.
        '@electron/rebuild',
        // Electron-native SQLite binding loaded in desktop runtime and packaging scripts.
        'better-sqlite3-multiple-ciphers',
        // Resolved as a Vite build entry/chunk dependency outside static source imports.
        'recharts',
        // Used by scripts/buildWebImageAssets.sh.
        'svgo',
        // Used via CSS @import "tailwindcss"; in client styles.
        'tailwindcss'
      ]
    },
    'packages/classic': {
      ignoreDependencies: [
        // Test-only support dependency used from files excluded by classic tsconfig.
        '@tearleads/db-test-utils'
      ]
    },
    'packages/keychain': {
      entry: ['src/clientEntry.ts']
    },
    'packages/vfs-sync': {
      entry: ['src/clientEntry.ts']
    },
    'packages/wallet': {
      entry: ['src/clientEntry.ts']
    },
    'packages/website': {
      ignoreDependencies: [
        // Used via CSS @import "tailwindcss"; in website styles.
        'tailwindcss'
      ]
    }
  }
};

export default config;
