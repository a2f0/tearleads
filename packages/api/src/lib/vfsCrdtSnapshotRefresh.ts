import { performance } from 'node:perf_hooks';
import {
  type AclSnapshotRow,
  type ContainerClockRow,
  type CursorRow,
  cloneCursor,
  isAccessLevel,
  isPrincipalType,
  type LinkSnapshotRow,
  normalizeRequiredString,
  type PgQueryable,
  parseCursor,
  parseOccurredAt,
  type SnapshotUpdatedAtRow,
  VFS_CRDT_SNAPSHOT_SCOPE,
  type VfsCrdtSnapshotPayload,
  type VfsCrdtSnapshotRefreshResult
} from './vfsCrdtSnapshotCommon.js';
import {
  createVfsCrdtQueryMetrics,
  emitVfsCrdtRoutePerfMetric,
  runTimedVfsCrdtQuery,
  type VfsCrdtQueryMetrics
} from './vfsCrdtPerformanceMetrics.js';

async function runSnapshotQuery<T>(
  client: PgQueryable,
  label: string,
  queryMetrics: VfsCrdtQueryMetrics | undefined,
  query: {
    text: string;
    values?: unknown[];
  }
): Promise<{ rows: T[] }> {
  if (!queryMetrics) {
    return client.query<T>(query.text, query.values);
  }

  return runTimedVfsCrdtQuery(label, queryMetrics, () =>
    client.query<T>(query.text, query.values)
  );
}

async function loadLatestCursor(
  client: PgQueryable,
  queryMetrics?: VfsCrdtQueryMetrics
) {
  const result = await runSnapshotQuery<CursorRow>(
    client,
    'snapshot_load_latest_cursor',
    queryMetrics,
    {
      text: `
    SELECT occurred_at, id
    FROM vfs_crdt_ops
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
    `
    }
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return parseCursor(row.occurred_at, row.id);
}

async function loadAclSnapshotRows(
  client: PgQueryable,
  queryMetrics?: VfsCrdtQueryMetrics
) {
  const result = await runSnapshotQuery<AclSnapshotRow>(
    client,
    'snapshot_load_acl_rows',
    queryMetrics,
    {
      text: `
    SELECT
      item_id,
      principal_type,
      principal_id,
      access_level
    FROM vfs_acl_entries
    WHERE revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY item_id ASC, principal_type ASC, principal_id ASC
    `
    }
  );

  const acl: VfsCrdtSnapshotPayload['replaySnapshot']['acl'] = [];
  for (const row of result.rows) {
    const itemId = normalizeRequiredString(row.item_id);
    const principalType = isPrincipalType(row.principal_type)
      ? row.principal_type
      : null;
    const principalId = normalizeRequiredString(row.principal_id);
    const accessLevel = isAccessLevel(row.access_level)
      ? row.access_level
      : null;
    if (!itemId || !principalType || !principalId || !accessLevel) {
      continue;
    }
    acl.push({
      itemId,
      principalType,
      principalId,
      accessLevel
    });
  }

  return acl;
}

async function loadLinkSnapshotRows(
  client: PgQueryable,
  queryMetrics?: VfsCrdtQueryMetrics
) {
  const result = await runSnapshotQuery<LinkSnapshotRow>(
    client,
    'snapshot_load_link_rows',
    queryMetrics,
    {
      text: `
    SELECT parent_id, child_id
    FROM vfs_links
    ORDER BY parent_id ASC, child_id ASC
    `
    }
  );

  const links: VfsCrdtSnapshotPayload['replaySnapshot']['links'] = [];
  for (const row of result.rows) {
    const parentId = normalizeRequiredString(row.parent_id);
    const childId = normalizeRequiredString(row.child_id);
    if (!parentId || !childId) {
      continue;
    }
    links.push({
      parentId,
      childId
    });
  }

  return links;
}

async function loadContainerClockRows(
  client: PgQueryable,
  queryMetrics?: VfsCrdtQueryMetrics
) {
  const result = await runSnapshotQuery<ContainerClockRow>(
    client,
    'snapshot_load_container_clocks',
    queryMetrics,
    {
      text: `
    WITH scoped_ops AS (
      SELECT
        CASE
          WHEN op_type IN ('link_add', 'link_remove') THEN parent_id
          ELSE item_id
        END AS container_id,
        occurred_at,
        id
      FROM vfs_crdt_ops
    ),
    latest_per_container AS (
      SELECT DISTINCT ON (container_id)
        container_id,
        occurred_at,
        id
      FROM scoped_ops
      WHERE container_id IS NOT NULL
      ORDER BY container_id ASC, occurred_at DESC, id DESC
    )
    SELECT
      container_id,
      occurred_at AS changed_at,
      id AS change_id
    FROM latest_per_container
    ORDER BY changed_at ASC, change_id ASC, container_id ASC
    `
    }
  );

  const containerClocks: VfsCrdtSnapshotPayload['containerClocks'] = [];
  for (const row of result.rows) {
    const containerId = normalizeRequiredString(row.container_id);
    const changedAt = parseOccurredAt(row.changed_at);
    const changeId = normalizeRequiredString(row.change_id);
    if (!containerId || !changedAt || !changeId) {
      continue;
    }
    containerClocks.push({
      containerId,
      changedAt,
      changeId
    });
  }

  return containerClocks;
}

async function buildVfsCrdtSnapshotPayload(
  client: PgQueryable,
  queryMetrics?: VfsCrdtQueryMetrics
): Promise<VfsCrdtSnapshotPayload> {
  const latestCursor = await loadLatestCursor(client, queryMetrics);
  const acl = await loadAclSnapshotRows(client, queryMetrics);
  const links = await loadLinkSnapshotRows(client, queryMetrics);
  const containerClocks = await loadContainerClockRows(client, queryMetrics);

  return {
    replaySnapshot: {
      acl,
      links,
      cursor: latestCursor ? cloneCursor(latestCursor) : null
    },
    containerClocks
  };
}

export async function refreshVfsCrdtSnapshot(
  client: PgQueryable,
  scope: string = VFS_CRDT_SNAPSHOT_SCOPE
): Promise<VfsCrdtSnapshotRefreshResult> {
  const queryMetrics = createVfsCrdtQueryMetrics();
  const startedAtMs = performance.now();

  try {
    const payload = await buildVfsCrdtSnapshotPayload(client, queryMetrics);
    const cursor = payload.replaySnapshot.cursor;

    const upsertResult = await runSnapshotQuery<SnapshotUpdatedAtRow>(
      client,
      'snapshot_upsert',
      queryMetrics,
      {
        text: `
    INSERT INTO vfs_crdt_snapshots (
      scope,
      snapshot_version,
      snapshot_payload,
      snapshot_cursor_changed_at,
      snapshot_cursor_change_id,
      created_at,
      updated_at
    )
    VALUES (
      $1::text,
      1,
      $2::jsonb,
      $3::timestamptz,
      $4::text,
      NOW(),
      NOW()
    )
    ON CONFLICT (scope) DO UPDATE SET
      snapshot_version = EXCLUDED.snapshot_version,
      snapshot_payload = EXCLUDED.snapshot_payload,
      snapshot_cursor_changed_at = EXCLUDED.snapshot_cursor_changed_at,
      snapshot_cursor_change_id = EXCLUDED.snapshot_cursor_change_id,
      updated_at = EXCLUDED.updated_at
    RETURNING updated_at
    `,
        values: [
          scope,
          JSON.stringify(payload),
          cursor?.changedAt ?? null,
          cursor?.changeId ?? null
        ]
      }
    );

    const updatedAt =
      parseOccurredAt(upsertResult.rows[0]?.updated_at ?? null) ??
      new Date().toISOString();

    const refreshResult: VfsCrdtSnapshotRefreshResult = {
      scope,
      updatedAt,
      cursor: cursor ? cloneCursor(cursor) : null,
      aclEntries: payload.replaySnapshot.acl.length,
      links: payload.replaySnapshot.links.length,
      containerClocks: payload.containerClocks.length
    };

    emitVfsCrdtRoutePerfMetric({
      route: 'snapshot_refresh',
      success: true,
      durationMs: performance.now() - startedAtMs,
      queryMetrics,
      operationCount:
        refreshResult.aclEntries +
        refreshResult.links +
        refreshResult.containerClocks,
      resultCount: 1
    });

    return refreshResult;
  } catch (error) {
    emitVfsCrdtRoutePerfMetric({
      route: 'snapshot_refresh',
      success: false,
      durationMs: performance.now() - startedAtMs,
      queryMetrics,
      error
    });
    throw error;
  }
}
