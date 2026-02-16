import { collabTables } from './definition-collab.js';
import { communicationsTables } from './definition-communications.js';
import { foundationTables } from './definition-foundation.js';
import { runtimeAiTables } from './definition-runtime-ai.js';
import type { TableDefinition } from './types.js';

export * from './definition-collab.js';
export * from './definition-communications.js';
export * from './definition-foundation.js';
export * from './definition-runtime-ai.js';

const excludedAllTableNames = new Set<string>([
  'vfs_blob_objects',
  'vfs_blob_staging',
  'vfs_blob_refs'
]);

export const allTables: TableDefinition[] = [
  ...foundationTables,
  ...collabTables,
  ...communicationsTables.filter(
    (table) => !excludedAllTableNames.has(table.name)
  ),
  ...runtimeAiTables
];

export const retiredRuntimeVfsTableNames = [
  'vfs_folders',
  'vfs_shares',
  'org_shares',
  'vfs_access'
] as const;

const retiredRuntimeVfsTableNameSet = new Set<string>(
  retiredRuntimeVfsTableNames
);

export const postgresRuntimeTables: TableDefinition[] = allTables.filter(
  (table) => !retiredRuntimeVfsTableNameSet.has(table.name)
);

export const sqliteRuntimeTables: TableDefinition[] = allTables.filter(
  (table) => !retiredRuntimeVfsTableNameSet.has(table.name)
);
