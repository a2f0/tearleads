import type {
  createTestDatabase as createTestDatabaseFn,
  TestKeyManager as TestKeyManagerClass,
  vfsTestMigrations as vfsTestMigrationsValue
} from '@tearleads/db-test-utils';

type DbTestUtilsModule = {
  createTestDatabase: typeof createTestDatabaseFn;
  TestKeyManager: typeof TestKeyManagerClass;
  vfsTestMigrations: typeof vfsTestMigrationsValue;
};

const DB_TEST_UTILS_MODULE_SPECIFIERS = [
  '@tearleads/db-test-utils',
  new URL('../../../db-test-utils/src/index.ts', import.meta.url).href,
  new URL('../../../db-test-utils/dist/index.js', import.meta.url).href
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDbTestUtilsModule(value: unknown): value is DbTestUtilsModule {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['createTestDatabase'] === 'function' &&
    typeof value['TestKeyManager'] === 'function' &&
    Array.isArray(value['vfsTestMigrations'])
  );
}

export async function getDbTestUtils(): Promise<DbTestUtilsModule> {
  let lastError: unknown;

  for (const specifier of DB_TEST_UTILS_MODULE_SPECIFIERS) {
    try {
      const candidate = await import(specifier);
      if (isDbTestUtilsModule(candidate)) {
        return candidate;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(`Unable to load DB test utils: ${reason}`);
}
