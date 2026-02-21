import type {
  PostgresColumnInfo,
  PostgresColumnsResponse
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';

/**
 * @openapi
 * /admin/postgres/tables/{schema}/{table}/columns:
 *   get:
 *     summary: Get column metadata for a Postgres table
 *     description: Returns column information from information_schema
 *     tags:
 *       - Admin
 *     parameters:
 *       - name: schema
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: table
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Column metadata
 *       404:
 *         description: Table not found
 *       500:
 *         description: Postgres connection error
 */
const getTablesSchemaTableColumnsHandler = async (
  req: Request,
  res: Response
) => {
  const { schema, table } = req.params;

  try {
    const pool = await getPostgresPool();

    const tableCheck = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      ) AS exists`,
      [schema, table]
    );

    if (!tableCheck.rows[0]?.exists) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }

    const result = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      ordinal_position: number;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table]
    );

    const columns: PostgresColumnInfo[] = result.rows.map((row) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      defaultValue: row.column_default,
      ordinalPosition: row.ordinal_position
    }));

    const response: PostgresColumnsResponse = { columns };
    res.json(response);
  } catch (err) {
    console.error('Postgres error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query Postgres'
    });
  }
};

export function registerGetTablesSchemaTableColumnsRoute(
  routeRouter: RouterType
): void {
  routeRouter.get(
    '/tables/:schema/:table/columns',
    getTablesSchemaTableColumnsHandler
  );
}
