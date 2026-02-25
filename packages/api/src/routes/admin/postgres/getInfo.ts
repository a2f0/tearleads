import type { PostgresAdminInfoResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool, getPostgresConnectionInfo } from '../../../lib/postgres.js';

/**
 * @openapi
 * /admin/postgres/info:
 *   get:
 *     summary: Get Postgres connection info
 *     description: Returns connection metadata and server version for the admin UI
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Connection details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 info:
 *                   type: object
 *                 serverVersion:
 *                   type: string
 *       500:
 *         description: Postgres connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
const getInfoHandler = async (_req: Request, res: Response) => {
  try {
    const pool = await getPool('read');
    const versionResult = await pool.query<{ version: string }>(
      'SELECT version() AS version'
    );
    const versionRow = versionResult.rows[0];
    const response: PostgresAdminInfoResponse = {
      status: 'ok',
      info: getPostgresConnectionInfo(),
      serverVersion: versionRow?.version ?? null
    };
    res.json(response);
  } catch (err) {
    console.error('Postgres error:', err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to connect to Postgres'
    });
  }
};

export function registerGetInfoRoute(routeRouter: RouterType): void {
  routeRouter.get('/info', getInfoHandler);
}
