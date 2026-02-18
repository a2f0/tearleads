import { resetMockApiServerState, server } from '@tearleads/msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  server.resetHandlers();
  resetMockApiServerState();
});

afterAll(() => {
  server.close();
});
