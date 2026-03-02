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
    // Class members are part of exported runtime/test harness APIs.
    'packages/api-client/src/vfsBlobNetworkFlusher.ts': ['classMembers'],
    'packages/api-client/src/vfsNetworkFlusher.ts': ['classMembers'],
    'packages/api-client/src/vfsWriteOrchestrator.ts': ['classMembers'],
    'packages/client/src/components/ui/ErrorBoundary.tsx': ['classMembers'],
    'packages/mls-core/src/mls.ts': ['classMembers'],
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
        'dependency-cruiser',
        // Buf codegen plugins executed by `pnpm protoGenerate`.
        '@bufbuild/protoc-gen-es',
        '@connectrpc/protoc-gen-connect-es'
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
      entry: ['src/test/**/*.ts']
    },
    'packages/shared': {
      ignoreDependencies: [
        // Runtime dependency of generated protobuf modules under src/gen.
        '@bufbuild/protobuf'
      ]
    },
    'packages/vfs-sync': {
      entry: ['src/**/*.test.ts']
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
