import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVfsCrdtSyncQuery } from '../protocol/sync-crdt-feed.js';
import { buildVfsSyncQuery } from './sync-engine.js';
import {
  deriveVfsFlatteningInventory,
  extractPostgresTableNamesFromDrizzleSchema,
  extractSqliteTableNamesFromDrizzleSchema,
  extractSqlTableReferences,
  isSqlReferenceSubsetOfFlattenedContract,
  VFS_SYNC_FLATTENED_TARGET_TABLES
} from './sync-schema-contract.js';

function extractSqlLiteralsFromSource(source: string): string[] {
  const sqlLiterals: string[] = [];
  const templatePattern = /`([\s\S]*?)`/gm;
  let match: RegExpExecArray | null = templatePattern.exec(source);
  while (match) {
    const body = match[1];
    if (body && /\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(body)) {
      sqlLiterals.push(body);
    }

    match = templatePattern.exec(source);
  }

  return sqlLiterals;
}

function extractShareReadReferences(sqlLiterals: string[]): string[] {
  return Array.from(
    new Set(
      sqlLiterals
        .filter((sql) => /\bSELECT\b/i.test(sql))
        .flatMap((sql) => extractSqlTableReferences(sql))
        .filter(
          (tableName) =>
            tableName === 'vfs_shares' || tableName === 'org_shares'
        )
    )
  ).sort((left, right) => left.localeCompare(right));
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
    const syncPackageRoot = join(import.meta.dirname, '../../..');
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
      new Set([...routeSql.flatMap((sql) => extractSqlTableReferences(sql))])
    ).sort((left, right) => left.localeCompare(right));

    expect(routeReferences).toEqual([
      'user_groups',
      'user_organizations',
      'vfs_acl_entries',
      'vfs_crdt_ops',
      'vfs_item_state',
      'vfs_links',
      'vfs_registry',
      'vfs_sync_client_state'
    ]);
    expect(
      routeReferences.every((tableName) =>
        VFS_SYNC_FLATTENED_TARGET_TABLES.includes(tableName)
      )
    ).toBe(true);
  });

  it('keeps blob stage/attach routes off blob staging tables', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');
    const postBlobStageSource = readFileSync(
      resolve(syncPackageRoot, '../api/src/routes/vfs/post-blobs-stage.ts'),
      'utf8'
    );
    const postBlobAttachSource = readFileSync(
      resolve(
        syncPackageRoot,
        '../api/src/routes/vfs/post-blobs-stage-stagingId-attach.ts'
      ),
      'utf8'
    );
    const postBlobAbandonSource = readFileSync(
      resolve(
        syncPackageRoot,
        '../api/src/routes/vfs/post-blobs-stage-stagingId-abandon.ts'
      ),
      'utf8'
    );

    const routeSql = [
      ...extractSqlLiteralsFromSource(postBlobStageSource),
      ...extractSqlLiteralsFromSource(postBlobAttachSource),
      ...extractSqlLiteralsFromSource(postBlobAbandonSource)
    ];
    const routeReferences = Array.from(
      new Set(routeSql.flatMap((sql) => extractSqlTableReferences(sql)))
    ).sort((left, right) => left.localeCompare(right));

    expect(routeReferences).toEqual(
      expect.arrayContaining([
        'vfs_links',
        'vfs_registry',
        'vfs_sync_client_state'
      ])
    );
    expect(routeReferences).not.toContain('vfs_blob_refs');
    expect(routeReferences).not.toContain('vfs_blob_staging');
  });

  it('keeps share routes on canonical ACL tables only', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');
    const shareRouteSources = [
      '../api/src/routes/vfs-shares/getItemsItemIdShares.ts',
      '../api/src/routes/vfs-shares/postItemsItemIdShares.ts',
      '../api/src/routes/vfs-shares/patchSharesShareId.ts',
      '../api/src/routes/vfs-shares/deleteSharesShareId.ts',
      '../api/src/routes/vfs-shares/postItemsItemIdOrgShares.ts',
      '../api/src/routes/vfs-shares/deleteOrgSharesShareId.ts',
      '../api/src/routes/vfs-shares/getShareTargetsSearch.ts'
    ].map((relativePath) =>
      readFileSync(resolve(syncPackageRoot, relativePath), 'utf8')
    );

    const routeSql = shareRouteSources.flatMap((source) =>
      extractSqlLiteralsFromSource(source)
    );
    const routeReferences = Array.from(
      new Set(routeSql.flatMap((sql) => extractSqlTableReferences(sql)))
    ).sort((left, right) => left.localeCompare(right));

    expect(routeReferences).toEqual(
      expect.arrayContaining(['vfs_acl_entries'])
    );
    expect(routeReferences).not.toContain('vfs_shares');
    expect(routeReferences).not.toContain('org_shares');
    expect(routeReferences).not.toContain('vfs_access');
    expect(routeReferences).not.toContain('vfs_folders');
  });

  it('keeps share-table read surface inventory empty', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');
    const shareReadRouteFiles = [
      {
        relativePath: '../api/src/routes/vfs-shares/getItemsItemIdShares.ts',
        expectedReadTables: []
      },
      {
        relativePath: '../api/src/routes/vfs-shares/patchSharesShareId.ts',
        expectedReadTables: []
      },
      {
        relativePath: '../api/src/routes/vfs-shares/deleteSharesShareId.ts',
        expectedReadTables: []
      },
      {
        relativePath: '../api/src/routes/vfs-shares/deleteOrgSharesShareId.ts',
        expectedReadTables: []
      },
      {
        relativePath: '../api/src/routes/vfs-shares/getShareTargetsSearch.ts',
        expectedReadTables: []
      }
    ];

    for (const file of shareReadRouteFiles) {
      const source = readFileSync(
        resolve(syncPackageRoot, file.relativePath),
        'utf8'
      );
      const routeSql = extractSqlLiteralsFromSource(source);
      expect(extractShareReadReferences(routeSql)).toEqual(
        file.expectedReadTables
      );
    }
  });

  it('detects SQL references that fall outside the flattened contract', () => {
    const unexpectedSql = `
      SELECT * FROM vfs_shadow_table;
    `;

    expect(extractSqlTableReferences(unexpectedSql)).toEqual([
      'vfs_shadow_table'
    ]);
    expect(isSqlReferenceSubsetOfFlattenedContract(unexpectedSql)).toBe(false);
  });

  it('remains compatible with generated Postgres schema', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');
    const generatedSchemaSource = [
      '../db/src/generated/postgresql/schema.ts',
      '../db/src/generated/postgresql/schema-content.ts',
      '../db/src/generated/postgresql/schema-foundation.ts',
      '../db/src/generated/postgresql/schema-policy.ts',
      '../db/src/generated/postgresql/schema-runtime.ts'
    ]
      .map((relativePath) =>
        readFileSync(resolve(syncPackageRoot, relativePath), 'utf8')
      )
      .join('\n');
    const generatedTables = extractPostgresTableNamesFromDrizzleSchema(
      generatedSchemaSource
    );
    const inventory = deriveVfsFlatteningInventory(generatedTables);

    expect(inventory.missingContractTables).toEqual([]);
  });

  it('remains compatible with generated SQLite schema', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');
    const generatedSchemaSource = [
      '../db/src/generated/sqlite/schema.ts',
      '../db/src/generated/sqlite/schema-content.ts',
      '../db/src/generated/sqlite/schema-foundation.ts',
      '../db/src/generated/sqlite/schema-policy.ts',
      '../db/src/generated/sqlite/schema-runtime.ts'
    ]
      .map((relativePath) =>
        readFileSync(resolve(syncPackageRoot, relativePath), 'utf8')
      )
      .join('\n');
    const generatedTables = extractSqliteTableNamesFromDrizzleSchema(
      generatedSchemaSource
    );
    const inventory = deriveVfsFlatteningInventory(generatedTables);

    expect(inventory.missingContractTables).toEqual([]);
  });
});
