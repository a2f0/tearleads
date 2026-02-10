import { registerGetInfoRoute } from './postgres/get-info.js';
import { registerGetTablesRoute } from './postgres/get-tables.js';
import { registerGetTablesSchemaTableColumnsRoute } from './postgres/get-tables-schema-table-columns.js';
import { registerGetTablesSchemaTableRowsRoute } from './postgres/get-tables-schema-table-rows.js';
import type {
  PostgresAdminInfoResponse,
  PostgresColumnInfo,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTableInfo,
  PostgresTablesResponse
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import {
  getPostgresConnectionInfo,
  getPostgresPool
} from '../../lib/postgres.js';

type PostgresTableRow = {
  schema: string;
  name: string;
  row_count: number | string | null;
  total_bytes: number | string | null;
  table_bytes: number | string | null;
  index_bytes: number | string | null;
};



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
export const getInfoHandler = async (_req: Request, res: Response) => {
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
      error:
        err instanceof Error ? err.message : 'Failed to connect to Postgres'
    });
  }
};

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
export const getTablesHandler = async (_req: Request, res: Response) => {
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

    const tables: PostgresTableInfo[] = result.rows.map(
      (row: PostgresTableRow) => ({
        schema: row.schema,
        name: row.name,
        rowCount: coerceNumber(row.row_count),
        totalBytes: coerceNumber(row.total_bytes),
        tableBytes: coerceNumber(row.table_bytes),
        indexBytes: coerceNumber(row.index_bytes)
      })
    );

    const response: PostgresTablesResponse = { tables };
    res.json(response);
  } catch (err) {
    console.error('Postgres error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query Postgres'
    });
  }
};

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
export const getTablesSchemaTableColumnsHandler = async (req: Request, res: Response) => {
    const { schema, table } = req.params;

    try {
      const pool = await getPostgresPool();

      // Validate table exists
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
export const getTablesSchemaTableRowsHandler = async (req: Request, res: Response) => {
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
    const offset = Math.max(
      parseInt(req.query['offset'] as string, 10) || 0,
      0
    );
    const sortColumn = req.query['sortColumn'] as string | undefined;
    const sortDirection = req.query['sortDirection'] as
      | 'asc'
      | 'desc'
      | undefined;

    try {
      const pool = await getPostgresPool();

      // Validate table exists and get columns to validate sortColumn
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

      const validColumns = new Set(
        columnsResult.rows.map((r) => r.column_name)
      );

      // Build query with safe identifier quoting
      const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
      const quotedTable = `"${table.replace(/"/g, '""')}"`;
      const fullTableName = `${quotedSchema}.${quotedTable}`;

      // Get total count
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${fullTableName}`
      );
      const totalCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

      // Build SELECT query
      let query = `SELECT * FROM ${fullTableName}`;

      // Add ORDER BY if valid column provided
      if (sortColumn && validColumns.has(sortColumn)) {
        const quotedColumn = `"${sortColumn.replace(/"/g, '""')}"`;
        const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
        query += ` ORDER BY ${quotedColumn} ${direction}`;
      }

      query += ` LIMIT $1 OFFSET $2`;

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

const postgresRouter: RouterType = Router();
registerGetInfoRoute(postgresRouter);
registerGetTablesRoute(postgresRouter);
registerGetTablesSchemaTableColumnsRoute(postgresRouter);
registerGetTablesSchemaTableRowsRoute(postgresRouter);

export { postgresRouter };
