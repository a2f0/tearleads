import { type BroadcastMessage, isRecord } from '@tearleads/shared';
import { getPostgresPool } from './postgres.js';
import { parseVfsContainerIdFromSyncChannel } from './vfsSyncChannels.js';

export const DEFAULT_NOTIFICATION_CHANNEL = 'broadcast';

const MLS_USER_CHANNEL_PREFIX = 'mls:user:';
const MLS_GROUP_CHANNEL_PREFIX = 'mls:group:';

async function isUserMemberOfGroup(
  userId: string,
  groupId: string
): Promise<boolean> {
  const pool = await getPostgresPool();
  const result = await pool.query(
    `SELECT 1
       FROM mls_group_members m
       INNER JOIN mls_groups g ON g.id = m.group_id
       INNER JOIN user_organizations uo
               ON uo.organization_id = g.organization_id
              AND uo.user_id = $2
      WHERE m.group_id = $1
        AND m.user_id = $2
        AND m.removed_at IS NULL
     LIMIT 1`,
    [groupId, userId]
  );
  return result.rows.length > 0;
}

async function filterAuthorizedVfsContainerIds(
  containerIds: string[],
  userId: string
): Promise<Set<string>> {
  if (containerIds.length === 0) {
    return new Set<string>();
  }

  const pool = await getPostgresPool();
  const result = await pool.query<{ item_id: string }>(
    `
    WITH principals AS (
      SELECT 'user'::text AS principal_type, $1::text AS principal_id
      UNION ALL
      SELECT 'group'::text AS principal_type, ug.group_id AS principal_id
      FROM user_groups ug
      WHERE ug.user_id = $1
      UNION ALL
      SELECT 'organization'::text AS principal_type, uo.organization_id AS principal_id
      FROM user_organizations uo
      WHERE uo.user_id = $1
    )
    SELECT DISTINCT entry.item_id
    FROM vfs_acl_entries entry
    INNER JOIN principals principal
      ON principal.principal_type = entry.principal_type
     AND principal.principal_id = entry.principal_id
    WHERE entry.item_id = ANY($2::text[])
      AND entry.revoked_at IS NULL
      AND (entry.expires_at IS NULL OR entry.expires_at > NOW())
    `,
    [userId, containerIds]
  );

  return new Set(
    result.rows
      .map((row) => row.item_id?.trim())
      .filter((itemId): itemId is string => itemId !== undefined && itemId !== '')
  );
}

export function normalizeRequestedChannels(
  channels: readonly string[]
): string[] {
  const normalized = channels
    .map((channel) => channel.trim())
    .filter((channel) => channel.length > 0);

  if (normalized.length === 0) {
    return [DEFAULT_NOTIFICATION_CHANNEL];
  }

  return normalized;
}

export async function filterAuthorizedChannels(
  channels: readonly string[],
  userId: string
): Promise<string[]> {
  const authorized: string[] = [];
  const knownVfsContainerIds = new Set<string>();
  for (const channel of channels) {
    const containerId = parseVfsContainerIdFromSyncChannel(channel);
    if (containerId) {
      knownVfsContainerIds.add(containerId);
    }
  }

  const authorizedVfsContainerIds =
    knownVfsContainerIds.size > 0
      ? await filterAuthorizedVfsContainerIds(
          Array.from(knownVfsContainerIds),
          userId
        )
      : new Set<string>();

  for (const channel of channels) {
    if (channel === DEFAULT_NOTIFICATION_CHANNEL) {
      authorized.push(channel);
      continue;
    }

    if (channel.startsWith(MLS_USER_CHANNEL_PREFIX)) {
      const channelUserId = channel.slice(MLS_USER_CHANNEL_PREFIX.length);
      if (channelUserId === userId) {
        authorized.push(channel);
      }
      continue;
    }

    if (channel.startsWith(MLS_GROUP_CHANNEL_PREFIX)) {
      const groupId = channel.slice(MLS_GROUP_CHANNEL_PREFIX.length);
      const isMember = await isUserMemberOfGroup(userId, groupId);
      if (isMember) {
        authorized.push(channel);
      }
      continue;
    }

    const vfsContainerId = parseVfsContainerIdFromSyncChannel(channel);
    if (vfsContainerId && authorizedVfsContainerIds.has(vfsContainerId)) {
      authorized.push(channel);
    }
  }

  return authorized;
}

export function parseBroadcastMessage(message: string): BroadcastMessage | null {
  try {
    const parsed = JSON.parse(message);
    return isBroadcastMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isBroadcastMessage(value: unknown): value is BroadcastMessage {
  return (
    isRecord(value) &&
    typeof value['type'] === 'string' &&
    'payload' in value &&
    typeof value['timestamp'] === 'string'
  );
}
