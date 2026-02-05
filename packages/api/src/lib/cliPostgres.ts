import { getPostgresConnectionInfo } from './postgres.js';

export function buildPostgresConnectionLabel(): string {
  const info = getPostgresConnectionInfo();
  const database = info.database ?? null;
  if (!database) {
    throw new Error(
      'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).'
    );
  }

  const labelParts = [
    info.host ? `host=${info.host}` : null,
    info.port ? `port=${info.port}` : null,
    info.user ? `user=${info.user}` : null,
    `database=${database}`
  ].filter((value): value is string => Boolean(value));

  return labelParts.join(', ');
}
