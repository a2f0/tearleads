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
  ignoreIssues: {},
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
    'packages/bob-and-alice': {
      entry: ['src/scenarios/**/*.test.ts', 'src/qa/**/*.test.ts']
    },
    'packages/db-test-utils': {
      entry: ['src/**/*.test.ts', 'src/**/*.test.tsx']
    },
    'packages/client': {
      entry: [
        'electron.vite.config.ts',
        'electron-builder.config.ts',
        'electron/main.ts',
        'electron/preload.ts',
        // CSS import graph includes @import "tailwindcss".
        'src/index.css'
      ],
      ignoreDependencies: [
        // Electron-native SQLite binding loaded in desktop runtime and packaging scripts.
        'better-sqlite3-multiple-ciphers',
        // Resolved as a Vite build entry/chunk dependency outside static source imports.
        'recharts',
        // Used by scripts/buildWebImageAssets.sh.
        'svgo'
      ]
    },
    'packages/classic': {
      entry: ['src/test/**/*.ts']
    },
    'packages/shared': {
      entry: ['src/gen/**/*.ts']
    },
    'packages/vfs-sync': {
      entry: ['src/**/*.test.ts']
    },
    'packages/website': {
      entry: [
        // CSS import graph includes @import "tailwindcss".
        'src/styles/global.css'
      ]
    }
  }
};

export default config;
