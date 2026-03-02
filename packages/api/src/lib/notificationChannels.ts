import { type BroadcastMessage, isRecord } from '@tearleads/shared';
import { getPostgresPool } from './postgres.js';
import { parseVfsContainerIdFromSyncChannel } from './vfsSyncChannels.js';

const DEFAULT_NOTIFICATION_CHANNEL = 'broadcast';

const MLS_USER_CHANNEL_PREFIX = 'mls:user:';
const MLS_GROUP_CHANNEL_PREFIX = 'mls:group:';

async function getAuthorizedGroupIdsForUser(
  userId: string,
  groupIds: readonly string[]
): Promise<Set<string>> {
  if (groupIds.length === 0) {
    return new Set<string>();
  }

  const pool = await getPostgresPool();
  const result = await pool.query<{ group_id: string }>(
    `SELECT m.group_id
       FROM mls_group_members m
       INNER JOIN mls_groups g ON g.id = m.group_id
       INNER JOIN user_organizations uo
               ON uo.organization_id = g.organization_id
              AND uo.user_id = $2
      WHERE m.group_id = ANY($1::text[])
        AND m.user_id = $2
        AND m.removed_at IS NULL`,
    [groupIds, userId]
  );

  return new Set(
    result.rows
      .map((row) => row.group_id?.trim())
      .filter(
        (groupId): groupId is string => groupId !== undefined && groupId !== ''
      )
  );
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
      .filter(
        (itemId): itemId is string => itemId !== undefined && itemId !== ''
      )
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
  const mlsGroupIds = new Set<string>();

  for (const channel of channels) {
    const containerId = parseVfsContainerIdFromSyncChannel(channel);
    if (containerId) {
      knownVfsContainerIds.add(containerId);
    }

    if (channel.startsWith(MLS_GROUP_CHANNEL_PREFIX)) {
      const groupId = channel.slice(MLS_GROUP_CHANNEL_PREFIX.length);
      if (groupId.length > 0) {
        mlsGroupIds.add(groupId);
      }
    }
  }

  const [authorizedVfsContainerIds, authorizedMlsGroupIds] = await Promise.all([
    knownVfsContainerIds.size > 0
      ? filterAuthorizedVfsContainerIds(
          Array.from(knownVfsContainerIds),
          userId
        )
      : Promise.resolve(new Set<string>()),
    mlsGroupIds.size > 0
      ? getAuthorizedGroupIdsForUser(userId, Array.from(mlsGroupIds))
      : Promise.resolve(new Set<string>())
  ]);

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
      if (authorizedMlsGroupIds.has(groupId)) {
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

export function parseBroadcastMessage(
  message: string
): BroadcastMessage | null {
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
