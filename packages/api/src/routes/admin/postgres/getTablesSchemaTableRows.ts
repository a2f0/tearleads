import type { PostgresRowsResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';

/**
 * @openapi
 * /admin/postgres/tables/{schema}/{table}/rows:
 *   get:
 *     summary: Get paginated rows from a Postgres table
 *     description: Returns rows with pagination and optional sorting
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
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *       - name: sortColumn
 *         in: query
 *         schema:
 *           type: string
 *       - name: sortDirection
 *         in: query
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Paginated rows
 *       404:
 *         description: Table not found
 *       500:
 *         description: Postgres connection error
 */
const getTablesSchemaTableRowsHandler = async (req: Request, res: Response) => {
  const schema = req.params['schema'];
  const table = req.params['table'];

  if (
    !schema ||
    !table ||
    typeof schema !== 'string' ||
    typeof table !== 'string'
  ) {
    res.status(400).json({ error: 'Schema and table are required' });
    return;
  }

  const limit = Math.min(
    Math.max(parseInt(req.query['limit'] as string, 10) || 50, 1),
    1000
  );
  const offset = Math.max(parseInt(req.query['offset'] as string, 10) || 0, 0);
  const sortColumn = req.query['sortColumn'] as string | undefined;
  const sortDirection = req.query['sortDirection'] as
    | 'asc'
    | 'desc'
    | undefined;

  try {
    const pool = await getPostgresPool();

    const columnsResult = await pool.query<{
      column_name: string;
    }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2`,
      [schema, table]
    );

    if (columnsResult.rows.length === 0) {
      res.status(404).json({ error: 'Table not found' });
      return;
    }

    const validColumns = new Set(columnsResult.rows.map((r) => r.column_name));

    const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
    const quotedTable = `"${table.replace(/"/g, '""')}"`;
    const fullTableName = `${quotedSchema}.${quotedTable}`;

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${fullTableName}`
    );
    const totalCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

    let query = `SELECT * FROM ${fullTableName}`;

    if (sortColumn && validColumns.has(sortColumn)) {
      const quotedColumn = `"${sortColumn.replace(/"/g, '""')}"`;
      const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
      query += ` ORDER BY ${quotedColumn} ${direction}`;
    }

    query += ' LIMIT $1 OFFSET $2';

    const rowsResult = await pool.query(query, [limit, offset]);

    const response: PostgresRowsResponse = {
      rows: rowsResult.rows,
      totalCount,
      limit,
      offset
    };
    res.json(response);
  } catch (err) {
    console.error('Postgres error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query Postgres'
    });
  }
};

export function registerGetTablesSchemaTableRowsRoute(
  routeRouter: RouterType
): void {
  routeRouter.get(
    '/tables/:schema/:table/rows',
    getTablesSchemaTableRowsHandler
  );
}
