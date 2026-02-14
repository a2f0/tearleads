import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVfsCrdtSyncQuery } from './sync-crdt-feed.js';
import { buildVfsSyncQuery } from './sync-engine.js';
import {
  deriveVfsFlatteningInventory,
  extractSqlTableReferences,
  extractPostgresTableNamesFromDrizzleSchema,
  isSqlReferenceSubsetOfFlattenedContract,
  VFS_SYNC_FLATTENED_TARGET_TABLES
} from './sync-schema-contract.js';

function extractSqlLiteralsFromSource(source: string): string[] {
  const sqlLiterals: string[] = [];
  const templatePattern = /`([\s\S]*?)`/gm;
  let match: RegExpExecArray | null = templatePattern.exec(source);
  while (match) {
    const body = match[1];
    if (
      body &&
      /\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(body)
    ) {
      sqlLiterals.push(body);
    }

    match = templatePattern.exec(source);
  }

  return sqlLiterals;
}

describe('sync schema contract', () => {
  it('covers SQL table references in sync and CRDT feed query builders', () => {
    const syncQuery = buildVfsSyncQuery({
      userId: 'user-1',
      limit: 25,
      cursor: null,
      rootId: null
    });
    const crdtQuery = buildVfsCrdtSyncQuery({
      userId: 'user-1',
      limit: 25,
      cursor: null,
      rootId: null
    });

    expect(extractSqlTableReferences(syncQuery.text)).toEqual([
      'user_groups',
      'user_organizations',
      'vfs_acl_entries',
      'vfs_links',
      'vfs_registry',
      'vfs_sync_changes'
    ]);
    expect(extractSqlTableReferences(crdtQuery.text)).toEqual([
      'user_groups',
      'user_organizations',
      'vfs_acl_entries',
      'vfs_crdt_ops',
      'vfs_links'
    ]);

    expect(isSqlReferenceSubsetOfFlattenedContract(syncQuery.text)).toBe(true);
    expect(isSqlReferenceSubsetOfFlattenedContract(crdtQuery.text)).toBe(true);
  });

  it('covers API CRDT route SQL references used for push/pull/reconcile', () => {
    const syncPackageRoot = process.cwd();
    const postPushSource = readFileSync(
      resolve(syncPackageRoot, '../api/src/routes/vfs/post-crdt-push.ts'),
      'utf8'
    );
    const getSyncSource = readFileSync(
      resolve(syncPackageRoot, '../api/src/routes/vfs/get-crdt-sync.ts'),
      'utf8'
    );
    const postReconcileSource = readFileSync(
      resolve(syncPackageRoot, '../api/src/routes/vfs/post-crdt-reconcile.ts'),
      'utf8'
    );

    const routeSql = [
      ...extractSqlLiteralsFromSource(postPushSource),
      ...extractSqlLiteralsFromSource(getSyncSource),
      ...extractSqlLiteralsFromSource(postReconcileSource)
    ];
    const routeReferences = Array.from(
      new Set([
        ...routeSql.flatMap((sql) => extractSqlTableReferences(sql))
      ])
    ).sort((left, right) => left.localeCompare(right));

    expect(routeReferences).toEqual([
      'vfs_crdt_ops',
      'vfs_registry',
      'vfs_sync_client_state'
    ]);
    expect(
      routeReferences.every((tableName) =>
        VFS_SYNC_FLATTENED_TARGET_TABLES.includes(tableName)
      )
    ).toBe(true);
  });

  it('detects SQL references that fall outside the flattened contract', () => {
    const unexpectedSql = `
      SELECT * FROM legacy_vfs_shadow_table;
    `;

    expect(extractSqlTableReferences(unexpectedSql)).toEqual([
      'legacy_vfs_shadow_table'
    ]);
    expect(isSqlReferenceSubsetOfFlattenedContract(unexpectedSql)).toBe(false);
  });

  it('remains compatible with generated Postgres schema and reports transitional VFS tables', () => {
    const syncPackageRoot = process.cwd();
    const generatedSchemaSource = readFileSync(
      resolve(syncPackageRoot, '../db/src/generated/postgresql/schema.ts'),
      'utf8'
    );
    const generatedTables = extractPostgresTableNamesFromDrizzleSchema(
      generatedSchemaSource
    );
    const inventory = deriveVfsFlatteningInventory(generatedTables);

    expect(inventory.missingContractTables).toEqual([]);
    expect(inventory.transitionalVfsTables).toEqual(
      expect.arrayContaining([
        'vfs_access',
        'vfs_blob_objects',
        'vfs_blob_refs',
        'vfs_blob_staging',
        'vfs_folders',
        'vfs_shares'
      ])
    );
  });
});
