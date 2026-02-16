import { vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';
import { createClient } from './redisMock.js';

// Guardrail: fail tests on console warnings/errors unless tests explicitly mock or assert them.
failOnConsole();

vi.mock('redis', () => ({
  createClient
}));
