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
  ignoreBinaries: ['ansible-lint', 'shellcheck'],
  ignoreDependencies: ['turbo'],
  ignoreIssues: {},
  workspaces: {
    '.': {
      entry: [
        'scripts/*.ts',
        'scripts/agents/**/*.ts',
        'scripts/checks/checkDependencyCruiser.ts',
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
    'packages/api': {
      entry: ['src/**/*.ts']
    },
    'packages/app-audio': {},
    'packages/chrome-extension': { entry: ['src/test/setup.ts'] },
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
        'electron/sqlite/**/*.ts',
        'scripts/optimizeSvg.ts',
        // Keep wrapper modules in the knip program to avoid TS reference
        // lookup crashes when colocated tests are removed.
        'src/lib/authStorage.ts',
        'src/lib/mediaDragData.ts',
        'src/lib/pingContract.ts',
        'src/lib/windowDimensionsStorage.ts',
        'src/lib/windowStatePreference.ts',
        // CSS import graph includes @import "tailwindcss".
        'src/index.css'
      ]
    },
    'packages/app-classic': {
      entry: ['src/test/**/*.ts']
    },
    'packages/app-help': {
      entry: ['src/**/*.test.tsx', 'src/test/**/*.ts']
    },
    'packages/app-health': {
      entry: ['src/test/**/*.ts']
    },
    'packages/shared': {
      entry: ['src/gen/**/*.ts']
    },
    'packages/vfs-sync': {
      entry: [
        'src/**/*.test.ts',
        'src/test/setup.ts',
        // Keep bloom filter protocol module in the knip program to avoid TS
        // reference lookup crashes when its transitive import graph is test-only.
        'src/vfs/protocol/syncBloomFilter.ts'
      ]
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
