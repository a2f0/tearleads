import { Code, ConnectError } from '@connectrpc/connect';
import {
  buildVfsV2ConnectMethodPath,
  type VfsCrdtPushResponse
} from '@tearleads/shared';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { invalidateReplicaWriteIdRowsForUser } from '../../lib/vfsCrdtReplicaWriteIds.js';
import { publishVfsContainerCursorBump } from '../../lib/vfsSyncChannels.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { applyCrdtPushOperations } from './vfsDirectCrdtPushApply.js';
import { parsePushPayload } from './vfsDirectCrdtPushParse.js';

interface PushCrdtOpsRequest {
  organizationId: string;
  clientId: string;
  operations: unknown[];
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

export async function pushCrdtOpsDirect(
  request: PushCrdtOpsRequest,
  context: { requestHeader: Headers }
): Promise<VfsCrdtPushResponse> {
  const parsedPayload = parsePushPayload({
    clientId: request.clientId,
    operations: request.operations
  });
  if (!parsedPayload.ok) {
    throw new ConnectError(parsedPayload.error, Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('PushCrdtOps'),
    context.requestHeader,
    {
      requireDeclaredOrganization: true,
      declaredOrganizationId: request.organizationId
    }
  );

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const pushResult = await applyCrdtPushOperations({
      client,
      userId: claims.sub,
      organizationId: claims.organizationId,
      parsedOperations: parsedPayload.value.operations
    });

    await client.query('COMMIT');
    inTransaction = false;

    await invalidateReplicaWriteIdRowsForUser(claims.sub);

    for (const notification of pushResult.notifications) {
      try {
        await publishVfsContainerCursorBump({
          containerId: notification.containerId,
          changedAt: notification.changedAt,
          changeId: notification.changeId,
          actorId: claims.sub,
          sourceClientId: parsedPayload.value.clientId
        });
      } catch (publishError) {
        console.error('Failed to publish VFS container cursor bump:', {
          containerId: notification.containerId,
          error: publishError
        });
      }
    }

    const response: VfsCrdtPushResponse = {
      clientId: parsedPayload.value.clientId,
      results: pushResult.results
    };

    return response;
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to push VFS CRDT operations:', error);
    throw new ConnectError('Failed to push CRDT operations', Code.Internal);
  } finally {
    client.release();
  }
}
