import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetTeeApiMsw } from './msw/handlers.js';
import { server } from './msw/server.js';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  server.resetHandlers();
  resetTeeApiMsw();
});

afterAll(() => {
  server.close();
});
