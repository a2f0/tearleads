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
  ignore: [
    'packages/client/android/**',
    'packages/client/ios/**'
  ],
  ignoreFiles: [
    'packages/**/src/generated/**',
    'packages/client/tests/playwright-env.d.ts'
  ],
  ignoreUnresolved: [
    '^@/db/analytics$'
  ],
  ignoreBinaries: ['ansible-lint', 'shellcheck', 'playwright'],
  // Used by scripts/costModel/db/postgres.ts, which is outside lint:knip tsconfig scope.
  ignoreDependencies: ['pg'],
  ignoreIssues: {
    // Consumed from source across package boundaries (admin/client split) via path aliases.
    'packages/client/src/lib/utils.ts': ['exports'],
    // Imported as a type-only contract by admin package via client alias.
    'packages/client/src/i18n/translations/types.ts': ['types'],
    // Imported by notifications package through client alias.
    'packages/client/src/stores/logStore.ts': ['types'],
    // Exported interface appears in an inferred cross-module public return type.
    'packages/vfs-explorer/src/hooks/useVfsAllItems.ts': ['types']
  },
  workspaces: {
    '.': {
      entry: [
        'scripts/*.ts',
        'scripts/agents/**/*.ts',
        'scripts/ciImpact/**/*.ts',
        'scripts/costModel/index.ts',
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
        'electronBuilder.config.ts',
        'electron/main.ts',
        'electron/preload.ts'
      ],
      // Resolved from Electron entrypoints and CSS tooling paths outside tsconfig project graph.
      ignoreDependencies: ['better-sqlite3-multiple-ciphers', 'tailwindcss']
    },
    'packages/classic': {
      // Only used by integration test support files that are excluded from current knip project scope.
      ignoreDependencies: ['@tearleads/db-test-utils']
    },
    'packages/website': {
      // Required by Astro/Tailwind CSS pipeline.
      ignoreDependencies: ['tailwindcss']
    },
    'packages/keychain': {
      entry: ['src/clientEntry.ts']
    },
    'packages/vfs-sync': {
      entry: ['src/clientEntry.ts']
    },
    'packages/wallet': {
      entry: ['src/clientEntry.ts']
    }
  }
};

export default config;
