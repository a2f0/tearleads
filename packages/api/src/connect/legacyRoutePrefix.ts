const TEST_LEGACY_ROUTE_PREFIX = '/v1';
const INTERNAL_LEGACY_ROUTE_PREFIX = '/_legacy';

export function getLegacyRoutePrefix(): string {
  return process.env['NODE_ENV'] === 'test'
    ? TEST_LEGACY_ROUTE_PREFIX
    : INTERNAL_LEGACY_ROUTE_PREFIX;
}
