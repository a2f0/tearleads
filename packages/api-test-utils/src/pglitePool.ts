import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import type { Pool as PgPool, QueryResult } from 'pg';

interface PgliteResult {
  rows: Record<string, unknown>[];
  affectedRows?: number;
  fields: Array<{ name: string; dataTypeID: number }>;
}

/**
 * PGlite's extended query protocol cannot handle:
 * - $$ dollar-quoted blocks (CREATE FUNCTION)
 * - Multiple statements separated by semicolons (DROP ...; CREATE ...)
 * When there are no bind parameters, use exec() (simple protocol) which
 * handles all of these correctly.
 */
function needsSimpleProtocol(sql: string): boolean {
  // If there's a $$ block, always use simple protocol
  if (sql.includes('$$')) return true;

  // Strip string literals and check for multiple semicolons
  const stripped = sql.replace(/'[^']*'/g, '');
  const semiCount = (stripped.match(/;/g) ?? []).length;
  return semiCount > 1;
}

function mapResult(raw: PgliteResult): QueryResult {
  // PGlite returns affectedRows=0 for SELECT. Use rows.length when
  // affectedRows is absent or zero and rows are present.
  const rowCount =
    raw.affectedRows && raw.affectedRows > 0
      ? raw.affectedRows
      : raw.rows.length;

  return {
    rows: raw.rows,
    rowCount,
    command: '',
    oid: 0,
    fields: (raw.fields ?? []).map((f) => ({
      name: f.name,
      tableID: 0,
      columnID: 0,
      dataTypeID: f.dataTypeID,
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: 'text' as const
    }))
  };
}

class PglitePoolClient extends EventEmitter {
  constructor(private readonly pglite: PGlite) {
    super();
  }

  async query(text: string, values?: unknown[]): Promise<QueryResult> {
    if (!values?.length && needsSimpleProtocol(text)) {
      await this.pglite.exec(text);
      return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
    }
    const result = (await this.pglite.query(
      text,
      values
    )) as unknown as PgliteResult;
    return mapResult(result);
  }

  release(): void {
    // no-op — PGlite is single-connection
  }
}

export class PglitePool extends EventEmitter {
  constructor(private readonly pglite: PGlite) {
    super();
  }

  async query(text: string, values?: unknown[]): Promise<QueryResult> {
    if (!values?.length && needsSimpleProtocol(text)) {
      await this.pglite.exec(text);
      return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
    }
    const result = (await this.pglite.query(
      text,
      values
    )) as unknown as PgliteResult;
    return mapResult(result);
  }

  async connect(): Promise<PglitePoolClient> {
    return new PglitePoolClient(this.pglite);
  }

  async end(): Promise<void> {
    await this.pglite.close();
  }
}

export async function createPglitePool(): Promise<{
  pool: PgPool;
  pglite: PGlite;
  /** Execute raw multi-statement SQL (bypasses prepared statement limitation) */
  exec: (sql: string) => Promise<void>;
}> {
  const pglite = new PGlite();
  const pool = new PglitePool(pglite) as unknown as PgPool;
  const exec = async (sql: string): Promise<void> => {
    await pglite.exec(sql);
  };
  return { pool, pglite, exec };
}
