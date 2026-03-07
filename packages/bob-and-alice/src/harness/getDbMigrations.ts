type DbMigrationsModule = {
  runMigrations: (
    pool: unknown,
    migrations: ReadonlyArray<unknown>
  ) => Promise<void>;
};

const DB_MIGRATIONS_MODULE_SPECIFIERS = [
  '@tearleads/db/migrations',
  new URL('../../../db/src/migrations/index.ts', import.meta.url).href,
  new URL('../../../db/dist/migrations/index.js', import.meta.url).href
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDbMigrationsModule(value: unknown): value is DbMigrationsModule {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value['runMigrations'] === 'function';
}

export async function getDbMigrations(): Promise<DbMigrationsModule> {
  let lastError: unknown;

  for (const specifier of DB_MIGRATIONS_MODULE_SPECIFIERS) {
    try {
      const candidate = await import(specifier);
      if (isDbMigrationsModule(candidate)) {
        return candidate;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(`Unable to load DB migrations module: ${reason}`);
}
