export type VfsSyncSchemaDomain =
  | 'syncFeed'
  | 'crdtFeed'
  | 'crdtPush'
  | 'crdtReconcile';

export interface VfsSyncSchemaDependency {
  tableName: string;
  domain: VfsSyncSchemaDomain;
  purpose: string;
}

export interface VfsFlatteningInventory {
  allGeneratedTables: string[];
  vfsGeneratedTables: string[];
  syncCriticalTablesPresent: string[];
  missingContractTables: string[];
}

/** Authoritative inventory of sync-critical table dependencies. */
export const VFS_SYNC_SCHEMA_DEPENDENCIES: VfsSyncSchemaDependency[] = [
  {
    tableName: 'vfs_effective_visibility',
    domain: 'syncFeed',
    purpose: 'denormalized item visibility and access rank for users'
  },
  {
    tableName: 'vfs_sync_changes',
    domain: 'syncFeed',
    purpose: 'cursor-ordered incremental object change feed with parent_id optimization'
  },
  {
    tableName: 'vfs_registry',
    domain: 'syncFeed',
    purpose: 'hydrate object metadata for change items'
  },
  {
    tableName: 'vfs_effective_visibility',
    domain: 'crdtFeed',
    purpose: 'denormalized visibility for CRDT operation feed'
  },
  {
    tableName: 'vfs_crdt_ops',
    domain: 'crdtFeed',
    purpose: 'cursor-ordered CRDT operation feed and replica write-id clocks'
  },
  {
    tableName: 'vfs_links',
    domain: 'crdtFeed',
    purpose: 'subtree visibility scoping by root item'
  },
  {
    tableName: 'vfs_crdt_snapshots',
    domain: 'crdtFeed',
    purpose: 'periodically persisted CRDT state snapshots for fast catch-up'
  },
  {
    tableName: 'vfs_registry',
    domain: 'crdtPush',
    purpose: 'ownership validation before accepting client CRDT pushes'
  },
  {
    tableName: 'vfs_crdt_ops',
    domain: 'crdtPush',
    purpose: 'idempotent source checks and canonical CRDT operation writes'
  },
  {
    tableName: 'vfs_item_state',
    domain: 'crdtPush',
    purpose: 'canonical encrypted item snapshot upsert/tombstone writes'
  },
  {
    tableName: 'vfs_sync_client_state',
    domain: 'crdtReconcile',
    purpose: 'monotonic per-client reconcile cursor + replica-write state'
  }
];

export const VFS_SYNC_FLATTENED_TARGET_TABLES = Array.from(
  new Set(
    VFS_SYNC_SCHEMA_DEPENDENCIES.map((dependency) => dependency.tableName)
  )
).sort((left, right) => left.localeCompare(right));

function extractCteNames(sql: string): Set<string> {
  const cteNames = new Set<string>();
  const pattern = /(?:\bWITH|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gim;
  let match: RegExpExecArray | null = pattern.exec(sql);
  while (match) {
    const rawName = match[1];
    if (rawName) {
      cteNames.add(rawName.toLowerCase());
    }
    match = pattern.exec(sql);
  }

  return cteNames;
}

function normalizeSqlTableReference(rawReference: string): string {
  return rawReference.replaceAll('"', '').split('.').pop() ?? rawReference;
}

export function extractSqlTableReferences(sql: string): string[] {
  const cteNames = extractCteNames(sql);
  const tableNames = new Set<string>();
  const pattern =
    /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?!SET\b)([a-zA-Z_"][a-zA-Z0-9_."-]*)/gim;
  let match: RegExpExecArray | null = pattern.exec(sql);
  while (match) {
    const rawReference = match[1];
    if (!rawReference) {
      match = pattern.exec(sql);
      continue;
    }

    const normalizedName =
      normalizeSqlTableReference(rawReference).toLowerCase();
    if (cteNames.has(normalizedName)) {
      match = pattern.exec(sql);
      continue;
    }

    tableNames.add(normalizedName);
    match = pattern.exec(sql);
  }

  return Array.from(tableNames).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function isSqlReferenceSubsetOfFlattenedContract(sql: string): boolean {
  const references = extractSqlTableReferences(sql);
  const allowedTables = new Set(VFS_SYNC_FLATTENED_TARGET_TABLES);
  for (const tableName of references) {
    if (!allowedTables.has(tableName)) {
      return false;
    }
  }

  return true;
}

export function extractPostgresTableNamesFromDrizzleSchema(
  source: string
): string[] {
  const tableNames = new Set<string>();
  const pattern = /pgTable\(\s*'([a-z0-9_]+)'/gim;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match) {
    const tableName = match[1];
    if (tableName) {
      tableNames.add(tableName.toLowerCase());
    }

    match = pattern.exec(source);
  }

  return Array.from(tableNames).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function extractSqliteTableNamesFromDrizzleSchema(
  source: string
): string[] {
  const tableNames = new Set<string>();
  const pattern = /sqliteTable\(\s*'([a-z0-9_]+)'/gim;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match) {
    const tableName = match[1];
    if (tableName) {
      tableNames.add(tableName.toLowerCase());
    }

    match = pattern.exec(source);
  }

  return Array.from(tableNames).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function deriveVfsFlatteningInventory(
  generatedTableNames: string[]
): VfsFlatteningInventory {
  const generatedTableSet = new Set(
    generatedTableNames.map((tableName) => tableName.toLowerCase())
  );
  const allGeneratedTables = Array.from(generatedTableSet).sort((left, right) =>
    left.localeCompare(right)
  );
  const vfsGeneratedTables = allGeneratedTables.filter((tableName) =>
    tableName.startsWith('vfs_')
  );
  const syncCriticalTablesPresent = VFS_SYNC_FLATTENED_TARGET_TABLES.filter(
    (tableName) => generatedTableSet.has(tableName)
  );
  const missingContractTables = VFS_SYNC_FLATTENED_TARGET_TABLES.filter(
    (tableName) => !generatedTableSet.has(tableName)
  );

  return {
    allGeneratedTables,
    vfsGeneratedTables,
    syncCriticalTablesPresent,
    missingContractTables
  };
}
