import {
  readRematerializationSnapshotCache,
  writeRematerializationSnapshotCache
} from './vfsCrdtRematerializationCache.js';
import { loadReplicaWriteIdRows } from './vfsCrdtReplicaWriteIds.js';
import {
  type ClientStateRow,
  cloneCursor,
  cloneWriteIds,
  isAccessLevel,
  isPrincipalType,
  isRecord,
  mergeWriteIds,
  normalizeReplicaWriteIds,
  normalizeRequiredString,
  type PgQueryable,
  parseCursor,
  parseLastReconciledWriteIds,
  parseOccurredAt,
  pickNewerCursor,
  type SnapshotRow,
  VFS_CRDT_SNAPSHOT_SCOPE,
  type VfsCrdtRematerializationSnapshot,
  type VfsCrdtSnapshotPayload,
  type VisibleItemRow
} from './vfsCrdtSnapshotCommon.js';

function normalizeSnapshotPayload(
  value: unknown
): VfsCrdtSnapshotPayload | null {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (!isRecord(candidate)) {
    return null;
  }

  const replaySnapshotValue = candidate['replaySnapshot'];
  const containerClocksValue = candidate['containerClocks'];
  if (!isRecord(replaySnapshotValue) || !Array.isArray(containerClocksValue)) {
    return null;
  }

  const aclValue = replaySnapshotValue['acl'];
  const linksValue = replaySnapshotValue['links'];
  const cursorValue = replaySnapshotValue['cursor'];
  if (!Array.isArray(aclValue) || !Array.isArray(linksValue)) {
    return null;
  }

  const acl: VfsCrdtSnapshotPayload['replaySnapshot']['acl'] = [];
  for (const entry of aclValue) {
    if (!isRecord(entry)) {
      continue;
    }
    const itemId = normalizeRequiredString(entry['itemId']);
    const principalType = isPrincipalType(entry['principalType'])
      ? entry['principalType']
      : null;
    const principalId = normalizeRequiredString(entry['principalId']);
    const accessLevel = isAccessLevel(entry['accessLevel'])
      ? entry['accessLevel']
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

  const links: VfsCrdtSnapshotPayload['replaySnapshot']['links'] = [];
  for (const entry of linksValue) {
    if (!isRecord(entry)) {
      continue;
    }
    const parentId = normalizeRequiredString(entry['parentId']);
    const childId = normalizeRequiredString(entry['childId']);
    if (!parentId || !childId) {
      continue;
    }
    links.push({
      parentId,
      childId
    });
  }

  const containerClocks: VfsCrdtSnapshotPayload['containerClocks'] = [];
  for (const entry of containerClocksValue) {
    if (!isRecord(entry)) {
      continue;
    }
    const containerId = normalizeRequiredString(entry['containerId']);
    const changedAt = normalizeRequiredString(entry['changedAt']);
    const changeId = normalizeRequiredString(entry['changeId']);
    if (!containerId || !changedAt || !changeId) {
      continue;
    }
    const normalizedChangedAt = parseOccurredAt(changedAt);
    if (!normalizedChangedAt) {
      continue;
    }
    containerClocks.push({
      containerId,
      changedAt: normalizedChangedAt,
      changeId
    });
  }

  let cursor = null;
  if (isRecord(cursorValue)) {
    const changedAt = normalizeRequiredString(cursorValue['changedAt']);
    const changeId = normalizeRequiredString(cursorValue['changeId']);
    if (changedAt && changeId) {
      cursor = parseCursor(changedAt, changeId);
    }
  }

  return {
    replaySnapshot: {
      acl,
      links,
      cursor
    },
    containerClocks
  };
}

async function loadPersistedSnapshot(
  client: PgQueryable,
  scope: string
): Promise<{
  payload: VfsCrdtSnapshotPayload;
  updatedAt: string;
} | null> {
  const result = await client.query<SnapshotRow>(
    `
    SELECT
      snapshot_payload,
      snapshot_cursor_changed_at,
      snapshot_cursor_change_id,
      updated_at
    FROM vfs_crdt_snapshots
    WHERE scope = $1::text
    LIMIT 1
    `,
    [scope]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const payload = normalizeSnapshotPayload(row.snapshot_payload);
  if (!payload) {
    return null;
  }

  const cursorFromColumns = parseCursor(
    row.snapshot_cursor_changed_at,
    row.snapshot_cursor_change_id
  );
  const effectiveCursor = pickNewerCursor(
    payload.replaySnapshot.cursor,
    cursorFromColumns
  );
  const updatedAt = parseOccurredAt(row.updated_at);
  if (!updatedAt) {
    return null;
  }

  return {
    payload: {
      replaySnapshot: {
        acl: payload.replaySnapshot.acl,
        links: payload.replaySnapshot.links,
        cursor: effectiveCursor ? cloneCursor(effectiveCursor) : null
      },
      containerClocks: payload.containerClocks.map((entry) => ({
        containerId: entry.containerId,
        changedAt: entry.changedAt,
        changeId: entry.changeId
      }))
    },
    updatedAt
  };
}

async function loadVisibleItemIds(
  client: PgQueryable,
  userId: string
): Promise<Set<string>> {
  const result = await client.query<VisibleItemRow>(
    `
    SELECT item_id
    FROM vfs_effective_visibility
    WHERE user_id = $1::uuid
    `,
    [userId]
  );

  const visibleItemIds = new Set<string>();
  for (const row of result.rows) {
    const itemId = normalizeRequiredString(row.item_id);
    if (itemId) {
      visibleItemIds.add(itemId);
    }
  }
  return visibleItemIds;
}

async function loadClientReconcileState(
  client: PgQueryable,
  userId: string,
  clientId: string
) {
  const clientStateResult = await client.query<ClientStateRow>(
    `
    SELECT
      last_reconciled_at,
      last_reconciled_change_id,
      last_reconciled_write_ids
    FROM vfs_sync_client_state
    WHERE user_id = $1::uuid
      AND client_id = $2::text
    LIMIT 1
    `,
    [userId, clientId]
  );

  const clientStateRow = clientStateResult.rows[0];
  const clientStateCursor = clientStateRow
    ? parseCursor(
        clientStateRow.last_reconciled_at,
        clientStateRow.last_reconciled_change_id
      )
    : null;
  const clientStateWriteIds = clientStateRow
    ? parseLastReconciledWriteIds(clientStateRow.last_reconciled_write_ids)
    : {};

  const replicaWriteIdsRows = await loadReplicaWriteIdRows(client, userId);

  return {
    cursor: clientStateCursor,
    lastReconciledWriteIds: mergeWriteIds(
      clientStateWriteIds,
      normalizeReplicaWriteIds(replicaWriteIdsRows)
    )
  };
}

export async function loadVfsCrdtRematerializationSnapshot(
  client: PgQueryable,
  input: {
    userId: string;
    clientId: string;
    scope?: string;
  }
): Promise<VfsCrdtRematerializationSnapshot | null> {
  const scope = input.scope ?? VFS_CRDT_SNAPSHOT_SCOPE;
  const snapshot = await loadPersistedSnapshot(client, scope);
  if (!snapshot) {
    return null;
  }

  const cachedFilteredSnapshot = await readRematerializationSnapshotCache({
    scope,
    userId: input.userId,
    clientId: input.clientId,
    snapshotUpdatedAt: snapshot.updatedAt
  });

  const filteredSnapshot = cachedFilteredSnapshot
    ? {
        replaySnapshot: cachedFilteredSnapshot.replaySnapshot,
        containerClocks: cachedFilteredSnapshot.containerClocks
      }
    : await (async (): Promise<{
        replaySnapshot: VfsCrdtSnapshotPayload['replaySnapshot'];
        containerClocks: VfsCrdtSnapshotPayload['containerClocks'];
      }> => {
        const visibleItemIds = await loadVisibleItemIds(client, input.userId);
        const replaySnapshot: VfsCrdtSnapshotPayload['replaySnapshot'] = {
          acl: snapshot.payload.replaySnapshot.acl.filter((entry) =>
            visibleItemIds.has(entry.itemId)
          ),
          links: snapshot.payload.replaySnapshot.links.filter((entry) =>
            visibleItemIds.has(entry.childId)
          ),
          cursor: snapshot.payload.replaySnapshot.cursor
            ? cloneCursor(snapshot.payload.replaySnapshot.cursor)
            : null
        };
        const containerClocks = snapshot.payload.containerClocks.filter(
          (entry) => visibleItemIds.has(entry.containerId)
        );
        await writeRematerializationSnapshotCache({
          scope,
          userId: input.userId,
          clientId: input.clientId,
          snapshotUpdatedAt: snapshot.updatedAt,
          snapshot: {
            replaySnapshot,
            containerClocks
          }
        });
        return {
          replaySnapshot,
          containerClocks
        };
      })();

  const clientReconcileState = await loadClientReconcileState(
    client,
    input.userId,
    input.clientId
  );

  const reconcileCursor = pickNewerCursor(
    filteredSnapshot.replaySnapshot.cursor,
    clientReconcileState.cursor
  );

  return {
    replaySnapshot: filteredSnapshot.replaySnapshot,
    reconcileState: reconcileCursor
      ? {
          cursor: reconcileCursor,
          lastReconciledWriteIds: cloneWriteIds(
            clientReconcileState.lastReconciledWriteIds
          )
        }
      : null,
    containerClocks: filteredSnapshot.containerClocks.map((entry) => ({
      containerId: entry.containerId,
      changedAt: entry.changedAt,
      changeId: entry.changeId
    })),
    snapshotUpdatedAt: snapshot.updatedAt
  };
}

export {
  VFS_CRDT_SNAPSHOT_SCOPE,
  type VfsCrdtRematerializationSnapshot,
  type VfsCrdtSnapshotPayload,
  type VfsCrdtSnapshotRefreshResult
} from './vfsCrdtSnapshotCommon.js';
export { refreshVfsCrdtSnapshot } from './vfsCrdtSnapshotRefresh.js';
