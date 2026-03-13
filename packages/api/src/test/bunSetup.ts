import { installVitestPolyfills } from '@tearleads/bun-dom-compat';
import { vi } from 'vitest';
import { createClient } from './redisMock.js';

installVitestPolyfills(vi);

// vitest-fail-on-console uses expect.getState() which is unavailable
// under Bun. Skip it and load only the redis mock (the essential part of setup.ts).
vi.mock('redis', () => ({
  createClient
}));
