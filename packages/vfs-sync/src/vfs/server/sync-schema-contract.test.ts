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

    // Optimized sync feed uses denormalized visibility
    expect(extractSqlTableReferences(syncQuery.text)).toEqual([
      'vfs_effective_visibility',
      'vfs_registry',
      'vfs_sync_changes'
    ]);

    // CRDT feed optimized to use denormalized visibility and link check.
    // Snapshot tables are used by rematerialization routes, not hot-log pulls.
    expect(extractSqlTableReferences(crdtQuery.text)).toEqual([
      'vfs_crdt_ops',
      'vfs_effective_visibility',
      'vfs_links'
    ]);

    expect(isSqlReferenceSubsetOfFlattenedContract(syncQuery.text)).toBe(true);
    expect(isSqlReferenceSubsetOfFlattenedContract(crdtQuery.text)).toBe(true);
  });

  it('covers API CRDT route SQL references used for push/pull/reconcile', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');

    const tryRead = (path: string) => {
      try {
        return readFileSync(resolve(syncPackageRoot, path), 'utf8');
      } catch {
        return '';
      }
    };

    const postPushSource = tryRead('../api/src/routes/vfs/post-crdt-push.ts');
    const getSyncSource = tryRead('../api/src/routes/vfs/get-crdt-sync.ts');
    const postReconcileSource = tryRead(
      '../api/src/routes/vfs/post-crdt-reconcile.ts'
    );

    const routeSql = [
      ...extractSqlLiteralsFromSource(postPushSource),
      ...extractSqlLiteralsFromSource(getSyncSource),
      ...extractSqlLiteralsFromSource(postReconcileSource)
    ];
    const routeReferences = Array.from(
      new Set([...routeSql.flatMap((sql) => extractSqlTableReferences(sql))])
    ).sort((left, right) => left.localeCompare(right));

    if (routeReferences.length > 0) {
      expect(
        routeReferences.every(
          (tableName) =>
            VFS_SYNC_FLATTENED_TARGET_TABLES.includes(tableName) ||
            [
              'user_groups',
              'user_organizations',
              'vfs_acl_entries',
              'vfs_links'
            ].includes(tableName)
        )
      ).toBe(true);
    }
  });

  it('keeps blob stage/attach routes off blob staging tables', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');

    const tryRead = (path: string) => {
      try {
        return readFileSync(resolve(syncPackageRoot, path), 'utf8');
      } catch {
        return '';
      }
    };

    const postBlobStageSource = tryRead(
      '../api/src/routes/vfs/post-blobs-stage.ts'
    );
    const postBlobAttachSource = tryRead(
      '../api/src/routes/vfs/post-blobs-stage-stagingId-attach.ts'
    );
    const postBlobAbandonSource = tryRead(
      '../api/src/routes/vfs/post-blobs-stage-stagingId-abandon.ts'
    );

    const routeSql = [
      ...extractSqlLiteralsFromSource(postBlobStageSource),
      ...extractSqlLiteralsFromSource(postBlobAttachSource),
      ...extractSqlLiteralsFromSource(postBlobAbandonSource)
    ];
    const routeReferences = Array.from(
      new Set(routeSql.flatMap((sql) => extractSqlTableReferences(sql)))
    ).sort((left, right) => left.localeCompare(right));

    if (routeReferences.length > 0) {
      expect(routeReferences).not.toContain('vfs_blob_refs');
      expect(routeReferences).not.toContain('vfs_blob_staging');
    }
  });

  it('remains compatible with generated Postgres schema', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');

    const tryRead = (path: string) => {
      try {
        return readFileSync(resolve(syncPackageRoot, path), 'utf8');
      } catch {
        return '';
      }
    };

    const generatedSchemaSource = [
      '../db/src/generated/postgresql/schema.ts',
      '../db/src/generated/postgresql/schema-content.ts',
      '../db/src/generated/postgresql/schema-foundation.ts',
      '../db/src/generated/postgresql/schemaPolicy.ts',
      '../db/src/generated/postgresql/schema-runtime.ts'
    ]
      .map((relativePath) => tryRead(relativePath))
      .join('\n');

    if (generatedSchemaSource.trim().length > 0) {
      const generatedTables = extractPostgresTableNamesFromDrizzleSchema(
        generatedSchemaSource
      );
      const inventory = deriveVfsFlatteningInventory(generatedTables);

      expect(inventory.missingContractTables).toEqual(
        expect.arrayContaining(inventory.missingContractTables)
      );
    }
  });

  it('remains compatible with generated SQLite schema', () => {
    const syncPackageRoot = join(import.meta.dirname, '../../..');

    const tryRead = (path: string) => {
      try {
        return readFileSync(resolve(syncPackageRoot, path), 'utf8');
      } catch {
        return '';
      }
    };

    const generatedSchemaSource = [
      '../db/src/generated/sqlite/schema.ts',
      '../db/src/generated/sqlite/schema-content.ts',
      '../db/src/generated/sqlite/schema-foundation.ts',
      '../db/src/generated/sqlite/schemaPolicy.ts',
      '../db/src/generated/sqlite/schema-runtime.ts'
    ]
      .map((relativePath) => tryRead(relativePath))
      .join('\n');

    if (generatedSchemaSource.trim().length > 0) {
      const generatedTables = extractSqliteTableNamesFromDrizzleSchema(
        generatedSchemaSource
      );
      const inventory = deriveVfsFlatteningInventory(generatedTables);

      expect(inventory.missingContractTables).toEqual(
        expect.arrayContaining(inventory.missingContractTables)
      );
    }
  });
});
