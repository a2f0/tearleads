import type { TestContextDeps } from '../../../api-test-utils/src/index';

type ApiDepsModule = {
  app: TestContextDeps['app'];
  migrations: TestContextDeps['migrations'];
};

const API_DEPS_MODULE_URLS = [
  new URL('../../../api/src/index.ts', import.meta.url),
  new URL('../../../api/dist/index.js', import.meta.url)
] as const;

function isApiDepsModule(value: unknown): value is ApiDepsModule {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ApiDepsModule>;
  return Boolean(candidate.app) && Array.isArray(candidate.migrations);
}

export async function getApiDeps(): Promise<TestContextDeps> {
  let lastError: unknown;

  for (const moduleUrl of API_DEPS_MODULE_URLS) {
    try {
      const candidate = await import(moduleUrl.href);
      if (isApiDepsModule(candidate)) {
        return { app: candidate.app, migrations: candidate.migrations };
      }
    } catch (error) {
      lastError = error;
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(`Unable to load API test deps: ${reason}`);
}
