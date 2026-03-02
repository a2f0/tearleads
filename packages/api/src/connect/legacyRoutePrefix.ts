const TEST_LEGACY_ROUTE_PREFIX = '/v1';
const INTERNAL_LEGACY_ROUTE_PREFIX = '/_legacy';

function isVitestRuntime(): boolean {
  return (
    process.env['VITEST'] === 'true' ||
    process.env['VITEST_POOL_ID'] !== undefined
  );
}

export function getLegacyRoutePrefix(): string {
  return process.env['NODE_ENV'] === 'test' || isVitestRuntime()
    ? TEST_LEGACY_ROUTE_PREFIX
    : INTERNAL_LEGACY_ROUTE_PREFIX;
}
