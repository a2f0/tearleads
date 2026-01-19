import type {
  PostgresAdminInfoResponse,
  PostgresTableInfo,
  PostgresTablesResponse
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresConnectionInfo, getPostgresPool } from '../../lib/postgres.js';

const router: RouterType = Router();

function coerceNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

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
router.get('/info', async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
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
      error: err instanceof Error ? err.message : 'Failed to connect to Postgres'
    });
  }
});

/**
 * @openapi
 * /admin/postgres/tables:
 *   get:
 *     summary: List Postgres tables with size and row metadata
 *     description: Returns user tables with row count and storage metrics
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of tables
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tables:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Postgres connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/tables', async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      schema: string;
      name: string;
      row_count: number | string;
      total_bytes: number | string;
      table_bytes: number | string;
      index_bytes: number | string;
    }>(`
      SELECT
        n.nspname AS schema,
        c.relname AS name,
        COALESCE(s.n_live_tup, 0) AS row_count,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_relation_size(c.oid) AS table_bytes,
        pg_indexes_size(c.oid) AS index_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname
    `);

    const tables: PostgresTableInfo[] = result.rows.map((row) => ({
      schema: row.schema,
      name: row.name,
      rowCount: coerceNumber(row.row_count),
      totalBytes: coerceNumber(row.total_bytes),
      tableBytes: coerceNumber(row.table_bytes),
      indexBytes: coerceNumber(row.index_bytes)
    }));

    const response: PostgresTablesResponse = { tables };
    res.json(response);
  } catch (err) {
    console.error('Postgres error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query Postgres'
    });
  }
});

export { router as postgresRouter };
