/**
 * PostgreSQL read-only connection for cost model queries
 *
 * Uses environment variables:
 * - POSTGRES_READ_ONLY_USER (default: costmodel_ro)
 * - POSTGRES_READ_ONLY_PASSWORD (required)
 * - POSTGRES_HOST (default: localhost)
 * - POSTGRES_PORT (default: 5432)
 * - POSTGRES_DATABASE (required)
 */
import { createRequire } from 'node:module';

export interface PostgresConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Check if required environment variables are set
 */
export function checkPostgresEnvVars(): {
  valid: boolean;
  missing: string[];
} {
  const required = ['POSTGRES_READ_ONLY_PASSWORD', 'POSTGRES_DATABASE'];
  const missing = required.filter((key) => !process.env[key]);

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Get postgres config from environment variables
 */
export function getPostgresConfig(): PostgresConfig {
  const { valid, missing } = checkPostgresEnvVars();
  if (!valid) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  const password = process.env.POSTGRES_READ_ONLY_PASSWORD;
  const database = process.env.POSTGRES_DATABASE;
  if (password === undefined || database === undefined) {
    throw new Error('Missing required PostgreSQL environment variables');
  }

  return {
    user: process.env.POSTGRES_READ_ONLY_USER ?? 'costmodel_ro',
    password,
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database
  };
}

type QueryResultRow = Record<string, unknown>;
type QueryResult = {
  rows: QueryResultRow[];
};
type PoolClient = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  release: () => void;
};
type PoolInstance = {
  connect: () => Promise<PoolClient>;
  end: () => Promise<void>;
};
type PoolConstructor = new (config: {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}) => PoolInstance;

const require = createRequire(import.meta.url);
const { Pool: PgPool } = require('pg') as { Pool: PoolConstructor };

let pool: PoolInstance | null = null;

/**
 * Get a connection pool (singleton)
 */
export function getPool(): PoolInstance {
  if (!pool) {
    const config = getPostgresConfig();
    pool = new PgPool({
      ...config,
      max: 3, // Read-only, minimal connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

/**
 * Execute a read-only query
 */
export async function query(
  sql: string,
  params?: unknown[]
): Promise<Record<string, unknown>[]> {
  const client = await getPool().connect();
  try {
    // Ensure read-only for the entire session on this client
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const result = await client.query(sql, params);
    return result.rows.filter(isRecord);
  } finally {
    client.release();
  }
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Test the database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW() as now');
    return result.length > 0;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}
