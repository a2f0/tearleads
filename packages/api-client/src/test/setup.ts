import { createTestContext, type TestContext } from '@tearleads/api-test-utils';
import {
  configureForExpressPassthrough,
  resetMockApiServerState,
  server
} from '@tearleads/msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setSharedTestContext } from './testContext';

let testContext: TestContext | null = null;

beforeAll(async () => {
  testContext = await createTestContext();
  setSharedTestContext(testContext);
  configureForExpressPassthrough('http://localhost', testContext.port);
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(async () => {
  server.resetHandlers();
  if (testContext) {
    configureForExpressPassthrough('http://localhost', testContext.port);
    await testContext.resetState();
  }
  resetMockApiServerState();
});

afterAll(async () => {
  server.close();
  await testContext?.teardown();
  testContext = null;
});
