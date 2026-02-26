import { getPostgresDevDefaults } from '../../../packages/shared/src/postgresDefaults.ts';

export interface PoolOptions {
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  connectionString?: string | undefined;
}

export interface PoolClient {
  query(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

export interface Pool {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  options: PoolOptions;
}

async function loadPgPoolConstructor(): Promise<
  new (
    config: PoolOptions
  ) => Pool
> {
  // Use a variable to prevent TypeScript from resolving 'pg' types statically.
  // The module is resolved at runtime by tsx; no @types/pg needed at build time.
  const moduleName = 'pg';
  const mod: { default?: { Pool: new (config: PoolOptions) => Pool } } =
    await import(moduleName);
  if (!mod.default) {
    throw new Error('Failed to load pg module');
  }
  return mod.default.Pool;
}

export async function createPool(): Promise<Pool> {
  const PgPool = await loadPgPoolConstructor();

  const databaseUrl =
    process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];
  if (databaseUrl) {
    return new PgPool({ connectionString: databaseUrl });
  }

  const defaults = getPostgresDevDefaults();
  return new PgPool({
    host: process.env['PGHOST'] ?? defaults.host,
    port: Number(process.env['PGPORT'] ?? defaults.port ?? 5432),
    user: process.env['PGUSER'] ?? defaults.user,
    password: process.env['PGPASSWORD'],
    database:
      process.env['PGDATABASE'] ?? defaults.database ?? 'tearleads_development'
  });
}

export function buildConnectionLabel(pool: Pool): string {
  const opts = pool.options;
  const parts = [
    opts.host ? `host=${opts.host}` : null,
    opts.port ? `port=${opts.port}` : null,
    opts.user ? `user=${opts.user}` : null,
    opts.database ? `database=${opts.database}` : null
  ].filter((v): v is string => Boolean(v));
  return parts.join(', ');
}
