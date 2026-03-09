import type { JsonObject, JsonValue } from '@bufbuild/protobuf';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AdminGetColumnsResponse,
  AdminGetPostgresInfoResponse,
  AdminGetRowsResponse,
  AdminGetTablesResponse
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import {
  AdminGetColumnsResponseSchema,
  AdminGetPostgresInfoResponseSchema,
  AdminGetRowsResponseSchema,
  AdminGetTablesResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { getPool, getPostgresConnectionInfo } from '../../lib/postgres.js';
import { requireAdminSession } from './adminDirectAuth.js';
import { queryTableMetadata } from './adminDirectPostgresShared.js';

type GetColumnsRequest = { schema: string; table: string };
type GetRowsRequest = {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sortColumn: string;
  sortDirection: string;
};

function normalizeRowsLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 50;
  }
  return Math.min(Math.floor(limit), 1000);
}

function normalizeRowsOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

function normalizeSortColumn(sortColumn: string): string | null {
  return sortColumn.trim().length > 0 ? sortColumn : null;
}

function normalizeSortDirection(sortDirection: string): 'ASC' | 'DESC' {
  return sortDirection === 'desc' ? 'DESC' : 'ASC';
}

function toInt64Value(value: number): bigint {
  if (!Number.isFinite(value)) {
    return 0n;
  }
  return BigInt(Math.trunc(value));
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }
  if (typeof value === 'object') {
    const jsonObject: JsonObject = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      jsonObject[entryKey] = toJsonValue(entryValue);
    }
    return jsonObject;
  }
  return String(value);
}

function toJsonObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const jsonObject: JsonObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    jsonObject[entryKey] = toJsonValue(entryValue);
  }
  return jsonObject;
}

export async function getPostgresInfoDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<AdminGetPostgresInfoResponse> {
  await requireAdminSession('/admin/postgres/info', context.requestHeader);

  try {
    const pool = await getPool('read');
    const versionResult = await pool.query<{ version: string }>(
      'SELECT version() AS version'
    );
    const connectionInfo = getPostgresConnectionInfo();
    const responseInfo = {
      ...(typeof connectionInfo.host === 'string'
        ? { host: connectionInfo.host }
        : {}),
      ...(typeof connectionInfo.port === 'number'
        ? { port: connectionInfo.port }
        : {}),
      ...(typeof connectionInfo.database === 'string'
        ? { database: connectionInfo.database }
        : {}),
      ...(typeof connectionInfo.user === 'string'
        ? { user: connectionInfo.user }
        : {})
    };
    return create(AdminGetPostgresInfoResponseSchema, {
      info: responseInfo,
      ...(typeof versionResult.rows[0]?.version === 'string'
        ? { serverVersion: versionResult.rows[0].version }
        : {})
    });
  } catch (error) {
    console.error('Postgres error:', error);
    throw new ConnectError('Failed to connect to Postgres', Code.Internal);
  }
}

export async function getTablesDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<AdminGetTablesResponse> {
  await requireAdminSession('/admin/postgres/tables', context.requestHeader);

  try {
    const pool = await getPool('read');
    const tables = await queryTableMetadata(pool);
    return create(AdminGetTablesResponseSchema, {
      tables: tables.map((table) => ({
        schema: table.schema,
        name: table.name,
        rowCount: toInt64Value(table.rowCount),
        totalBytes: toInt64Value(table.totalBytes),
        tableBytes: toInt64Value(table.tableBytes),
        indexBytes: toInt64Value(table.indexBytes)
      }))
    });
  } catch (error) {
    console.error('Postgres error:', error);
    throw new ConnectError('Failed to query Postgres', Code.Internal);
  }
}

export async function getColumnsDirect(
  request: GetColumnsRequest,
  context: { requestHeader: Headers }
): Promise<AdminGetColumnsResponse> {
  await requireAdminSession(
    `/admin/postgres/tables/${request.schema}/${request.table}/columns`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const tableCheck = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      ) AS exists`,
      [request.schema, request.table]
    );

    if (!tableCheck.rows[0]?.exists) {
      throw new ConnectError('Table not found', Code.NotFound);
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
      [request.schema, request.table]
    );

    return create(AdminGetColumnsResponseSchema, {
      columns: result.rows.map((row) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        ...(typeof row.column_default === 'string'
          ? { defaultValue: row.column_default }
          : {}),
        ordinalPosition: row.ordinal_position
      }))
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Postgres error:', error);
    throw new ConnectError('Failed to query Postgres', Code.Internal);
  }
}

export async function getRowsDirect(
  request: GetRowsRequest,
  context: { requestHeader: Headers }
): Promise<AdminGetRowsResponse> {
  await requireAdminSession(
    `/admin/postgres/tables/${request.schema}/${request.table}/rows`,
    context.requestHeader
  );

  const limit = normalizeRowsLimit(request.limit);
  const offset = normalizeRowsOffset(request.offset);
  const sortColumn = normalizeSortColumn(request.sortColumn);
  const sortDirection = normalizeSortDirection(request.sortDirection);

  try {
    const pool = await getPool('read');
    const columnsResult = await pool.query<{
      column_name: string;
    }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2`,
      [request.schema, request.table]
    );

    if (columnsResult.rows.length === 0) {
      throw new ConnectError('Table not found', Code.NotFound);
    }

    const validColumns = new Set(
      columnsResult.rows.map((row) => row.column_name)
    );
    const quotedSchema = `"${request.schema.replace(/"/g, '""')}"`;
    const quotedTable = `"${request.table.replace(/"/g, '""')}"`;
    const fullTableName = `${quotedSchema}.${quotedTable}`;

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${fullTableName}`
    );
    const totalCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

    let query = `SELECT * FROM ${fullTableName}`;
    if (sortColumn && validColumns.has(sortColumn)) {
      const quotedColumn = `"${sortColumn.replace(/"/g, '""')}"`;
      query += ` ORDER BY ${quotedColumn} ${sortDirection}`;
    }
    query += ' LIMIT $1 OFFSET $2';

    const rowsResult = await pool.query(query, [limit, offset]);
    return create(AdminGetRowsResponseSchema, {
      rows: rowsResult.rows.map((row) => toJsonObject(row)),
      totalCount: toInt64Value(totalCount),
      limit,
      offset
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Postgres error:', error);
    throw new ConnectError('Failed to query Postgres', Code.Internal);
  }
}
