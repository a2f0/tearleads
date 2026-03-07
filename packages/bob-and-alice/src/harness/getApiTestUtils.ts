import type {
  createPglitePool as createPglitePoolFn,
  createRedisMock as createRedisMockFn,
  createTestContext as createTestContextFn,
  seedTestUser as seedTestUserFn
} from '@tearleads/api-test-utils';

type ApiTestUtilsModule = {
  createPglitePool: typeof createPglitePoolFn;
  createRedisMock: typeof createRedisMockFn;
  createTestContext: typeof createTestContextFn;
  seedTestUser: typeof seedTestUserFn;
};

const API_TEST_UTILS_MODULE_SPECIFIERS = [
  '@tearleads/api-test-utils',
  new URL('../../../api-test-utils/src/index.ts', import.meta.url).href,
  new URL('../../../api-test-utils/dist/index.js', import.meta.url).href
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiTestUtilsModule(value: unknown): value is ApiTestUtilsModule {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['createPglitePool'] === 'function' &&
    typeof value['createRedisMock'] === 'function' &&
    typeof value['createTestContext'] === 'function' &&
    typeof value['seedTestUser'] === 'function'
  );
}

export async function getApiTestUtils(): Promise<ApiTestUtilsModule> {
  let lastError: unknown;

  for (const specifier of API_TEST_UTILS_MODULE_SPECIFIERS) {
    try {
      const candidate = await import(specifier);
      if (isApiTestUtilsModule(candidate)) {
        return candidate;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(`Unable to load API test utils: ${reason}`);
}
