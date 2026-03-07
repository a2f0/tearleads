import type { TestDatabaseContext } from '@tearleads/db-test-utils';

interface LocalItemPermission {
  itemId: string;
  currentUserId: string;
  exists: boolean;
  isOwner: boolean;
  accessRank: 0 | 1 | 2 | 3;
  permissionLevel: 'none' | 'view' | 'edit' | 'owner';
  canRead: boolean;
  canEdit: boolean;
}

function toAccessRank(value: unknown): 0 | 1 | 2 | 3 {
  const numeric = Number(value);
  if (numeric >= 3) {
    return 3;
  }
  if (numeric >= 2) {
    return 2;
  }
  if (numeric >= 1) {
    return 1;
  }
  return 0;
}

function permissionLevelForRank(
  rank: 0 | 1 | 2 | 3,
  isOwner: boolean
): LocalItemPermission['permissionLevel'] {
  if (isOwner) {
    return 'owner';
  }
  if (rank >= 2) {
    return 'edit';
  }
  if (rank >= 1) {
    return 'view';
  }
  return 'none';
}

export async function queryLocalItemPermission(input: {
  localDb: TestDatabaseContext;
  itemId: string;
  currentUserId: string;
  nowMillis?: number;
}): Promise<LocalItemPermission> {
  const nowMillis = input.nowMillis ?? Date.now();

  const registryResult = await input.localDb.adapter.execute(
    `SELECT owner_id
     FROM vfs_registry
     WHERE id = ?
     LIMIT 1`,
    [input.itemId]
  );
  const ownerIdRaw = registryResult.rows[0]?.['owner_id'];
  const ownerId =
    ownerIdRaw === null || ownerIdRaw === undefined ? null : String(ownerIdRaw);
  const exists = registryResult.rows.length > 0;
  const isOwner = ownerId === input.currentUserId;

  const aclResult = await input.localDb.adapter.execute(
    `SELECT COALESCE(
       MAX(
         CASE access_level
           WHEN 'admin' THEN 3
           WHEN 'write' THEN 2
           ELSE 1
         END
       ),
       0
     ) AS access_rank
     FROM vfs_acl_entries
     WHERE item_id = ?
       AND principal_type = 'user'
       AND principal_id = ?
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
    [input.itemId, input.currentUserId, nowMillis]
  );

  const aclRank = toAccessRank(aclResult.rows[0]?.['access_rank']);
  const accessRank: 0 | 1 | 2 | 3 = exists ? (isOwner ? 3 : aclRank) : 0;
  const permissionLevel = permissionLevelForRank(accessRank, isOwner);

  return {
    itemId: input.itemId,
    currentUserId: input.currentUserId,
    exists,
    isOwner,
    accessRank,
    permissionLevel,
    canRead: accessRank >= 1,
    canEdit: accessRank >= 2
  };
}
