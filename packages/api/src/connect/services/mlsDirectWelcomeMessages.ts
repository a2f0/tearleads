import { Code, ConnectError } from '@connectrpc/connect';
import type {
  MlsWelcomeMessage,
  MlsWelcomeMessagesResponse
} from '@tearleads/shared';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { parseAckWelcomePayload } from '../../routes/mls/shared.js';
import { requireMlsClaims } from './mlsDirectAuth.js';

type AckWelcomeRequest = { id: string; json: string };

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function parseJsonBody(json: string): unknown {
  const normalized = json.trim().length > 0 ? json : '{}';
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

export async function getWelcomeMessagesDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireMlsClaims(
    '/mls/welcome-messages',
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      group_id: string;
      group_name: string;
      welcome_data: string;
      key_package_ref: string;
      epoch: number;
      created_at: Date | string;
    }>(
      `SELECT w.id, w.group_id, g.name as group_name, w.welcome_data, w.key_package_ref,
              w.epoch, w.created_at
       FROM mls_welcome_messages w
       JOIN mls_groups g ON w.group_id = g.id
       JOIN user_organizations uo
         ON uo.organization_id = g.organization_id
        AND uo.user_id = $1
       WHERE w.recipient_user_id = $1 AND w.consumed_at IS NULL
       ORDER BY w.created_at DESC`,
      [claims.sub]
    );

    const welcomes: MlsWelcomeMessage[] = result.rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      welcome: row.welcome_data,
      keyPackageRef: row.key_package_ref,
      epoch: row.epoch,
      createdAt: toIsoString(row.created_at)
    }));

    const response: MlsWelcomeMessagesResponse = { welcomes };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get welcome messages:', error);
    throw new ConnectError('Failed to get welcome messages', Code.Internal);
  }
}

export async function acknowledgeWelcomeDirect(
  request: AckWelcomeRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireMlsClaims(
    `/mls/welcome-messages/${encoded(request.id)}/ack`,
    context.requestHeader
  );
  const payload = parseAckWelcomePayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError('groupId is required', Code.InvalidArgument);
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query(
      `UPDATE mls_welcome_messages SET consumed_at = NOW()
       WHERE id = $1
         AND recipient_user_id = $2
         AND group_id = $3
         AND EXISTS (
           SELECT 1
             FROM mls_groups g
             INNER JOIN user_organizations uo
                     ON uo.organization_id = g.organization_id
                    AND uo.user_id = $2
            WHERE g.id = $3
         )
         AND consumed_at IS NULL`,
      [request.id, claims.sub, payload.groupId]
    );

    if (result.rowCount === 0) {
      throw new ConnectError(
        'Welcome message not found or already acknowledged',
        Code.NotFound
      );
    }

    return { json: JSON.stringify({ acknowledged: true }) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to acknowledge welcome:', error);
    throw new ConnectError('Failed to acknowledge welcome', Code.Internal);
  }
}
