import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  $schema: './node_modules/knip/schema.json',
  include: [
    'files',
    'dependencies',
    'devDependencies',
    'exports',
    'types',
    'unlisted',
    'unresolved',
    'binaries'
  ],
  ignoreBinaries: ['ansible-lint', 'shellcheck', 'playwright'],
  ignore: [
    // Test stubs resolved via vitest path alias (`@` → clientCompat); knip cannot follow aliases.
    'packages/analytics/src/test/clientCompat/**'
  ],
  ignoreIssues: {
    // Consumed from source across package boundaries (admin/client split) via path aliases.
    'packages/client/src/lib/utils.ts': ['exports'],
    // Imported as a type-only contract by admin package via client alias.
    'packages/client/src/i18n/translations/types.ts': ['types'],
    // Imported by notifications package through client alias.
    'packages/client/src/stores/logStore.ts': ['types'],
    // Public barrel exports consumed across workspace packages.
    'packages/vfs-explorer/src/components/index.ts': ['exports'],
    // Exported public API return type expected by consumers.
    'packages/api-client/src/apiRoutes/vfsRoutes.ts': ['types'],
    // Exported interface appears in an inferred cross-module public return type.
    'packages/vfs-explorer/src/hooks/useVfsAllItems.ts': ['types'],
    // Test helper surface for org change event subscription in orgStorage tests.
    'packages/client/src/lib/orgStorage.ts': ['exports'],
    // Canonical DB schema pieces intentionally re-exported across definition modules.
    'packages/db/src/schema/definition-communications-vfs.ts': ['exports'],
    'packages/db/src/schema/definition-communications.ts': ['exports'],
    'packages/db/src/schema/definitionCommunicationsAi.ts': ['exports'],
    // Exported interfaces are part of public signatures for published helpers.
    'packages/api/src/lib/vfsSyncChannels.ts': ['exports', 'types'],
    'packages/bob-and-alice/src/qa/vfsSecureUploadQaSuite.ts': ['types'],
    'packages/db-test-utils/src/seeding/pgScenario.ts': ['types']
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
      ]
    },
    'packages/app-builder': {
      entry: ['apps/*/config.ts']
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
