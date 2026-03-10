import {
  type ApiV2ServiceHarness,
  createTestContext,
  startApiV2ServiceHarness,
  type TestContext
} from '@tearleads/api-test-utils';
import {
  configureForExpressPassthrough,
  resetMockApiServerState,
  server
} from '@tearleads/msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setSharedTestContext } from './testContext';

let testContext: TestContext | null = null;
let apiV2Harness: ApiV2ServiceHarness | null = null;

const API_V2_ADMIN_ROUTE_PATTERN =
  /^\/(?:v1\/)?connect\/tearleads\.v2\.AdminService\//;

function configurePassthroughRoutes(): void {
  if (!testContext) {
    return;
  }

  const routeOverrides =
    apiV2Harness === null
      ? []
      : [
          {
            pathnamePattern: API_V2_ADMIN_ROUTE_PATTERN,
            targetPort: apiV2Harness.port,
            pathPrefix: '/v1'
          }
        ];

  configureForExpressPassthrough(
    'http://localhost',
    testContext.port,
    '/v1',
    routeOverrides
  );
}

beforeAll(async () => {
  [testContext, apiV2Harness] = await Promise.all([
    createTestContext(async () => {
      const api = await import('@tearleads/api');
      return { app: api.app, migrations: api.migrations };
    }),
    startApiV2ServiceHarness()
  ]);
  setSharedTestContext(testContext);
  configurePassthroughRoutes();
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(async () => {
  server.resetHandlers();
  if (testContext) {
    configurePassthroughRoutes();
    await testContext.resetState();
  }
  resetMockApiServerState();
});

afterAll(async () => {
  server.close();
  await apiV2Harness?.stop();
  apiV2Harness = null;
  await testContext?.teardown();
  testContext = null;
});
