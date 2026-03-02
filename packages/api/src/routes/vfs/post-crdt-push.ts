import { performance } from 'node:perf_hooks';
import type { VfsCrdtPushResponse } from '@tearleads/shared';
import {
  decodeVfsCrdtPushRequestProtobuf,
  encodeVfsCrdtPushResponseProtobuf
} from '@tearleads/vfs-sync/vfs';
import type { Request, Response, Router as RouterType } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  createVfsCrdtQueryMetrics,
  emitVfsCrdtRoutePerfMetric,
  mergeVfsCrdtQueryMetrics,
  runTimedVfsCrdtQuery
} from '../../lib/vfsCrdtPerformanceMetrics.js';
import { publishVfsContainerCursorBump } from '../../lib/vfsSyncChannels.js';
import {
  createCrdtProtobufRawBodyParser,
  decodeCrdtRequestBody,
  sendCrdtProtobufOrJson
} from './crdtProtobuf.js';
import { applyCrdtPushOperations } from './crdtPushApply.js';
import { parsePushPayload } from './post-crdt-push-parse.js';

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

/**
 * @openapi
 * /vfs/crdt/push:
 *   post:
 *     summary: Push client-authored CRDT operations
 *     description: Accepts CRDT operations from a client replica and returns per-op acknowledgements.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - operations
 *             properties:
 *               clientId:
 *                 type: string
 *               operations:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: |
 *           Per-op push acknowledgement results.
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const postCrdtPushHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const decodedRequestBody = decodeCrdtRequestBody(
    req,
    decodeVfsCrdtPushRequestProtobuf
  );
  if (!decodedRequestBody.ok) {
    res.status(400).json({ error: decodedRequestBody.error });
    return;
  }

  const parsedPayload = parsePushPayload(decodedRequestBody.value);
  if (!parsedPayload.ok) {
    res.status(400).json({ error: parsedPayload.error });
    return;
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  const routeQueryMetrics = createVfsCrdtQueryMetrics();
  const routeStartedAtMs = performance.now();
  let pushQueryMetrics: ReturnType<typeof createVfsCrdtQueryMetrics> | null = null;
  let inTransaction = false;

  try {
    await runTimedVfsCrdtQuery('begin', routeQueryMetrics, () =>
      client.query('BEGIN')
    );
    inTransaction = true;

    const pushResult = await applyCrdtPushOperations({
      client,
      userId: claims.sub,
      parsedOperations: parsedPayload.value.operations
    });
    pushQueryMetrics = pushResult.queryMetrics;

    await runTimedVfsCrdtQuery('commit', routeQueryMetrics, () =>
      client.query('COMMIT')
    );
    inTransaction = false;

    const response: VfsCrdtPushResponse = {
      clientId: parsedPayload.value.clientId,
      results: pushResult.results
    };

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

    sendCrdtProtobufOrJson(
      req,
      res,
      200,
      response,
      encodeVfsCrdtPushResponseProtobuf
    );

    emitVfsCrdtRoutePerfMetric({
      route: 'push',
      success: true,
      durationMs: performance.now() - routeStartedAtMs,
      queryMetrics: mergeVfsCrdtQueryMetrics(
        routeQueryMetrics,
        pushResult.queryMetrics
      ),
      operationCount: parsedPayload.value.operations.length,
      resultCount: pushResult.results.length
    });
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    emitVfsCrdtRoutePerfMetric({
      route: 'push',
      success: false,
      durationMs: performance.now() - routeStartedAtMs,
      queryMetrics: pushQueryMetrics
        ? mergeVfsCrdtQueryMetrics(routeQueryMetrics, pushQueryMetrics)
        : routeQueryMetrics,
      operationCount: parsedPayload.value.operations.length,
      error
    });

    console.error('Failed to push VFS CRDT operations:', error);
    res.status(500).json({ error: 'Failed to push CRDT operations' });
  } finally {
    client.release();
  }
};

export function registerPostCrdtPushRoute(routeRouter: RouterType): void {
  routeRouter.post(
    '/crdt/push',
    createCrdtProtobufRawBodyParser(),
    postCrdtPushHandler
  );
}
