import { afterAll, afterEach, beforeEach } from 'vitest';
import { createConsoleGuardRuntime } from './consoleGuardRuntime.js';

const consoleGuardRuntime = createConsoleGuardRuntime();

beforeEach(() => {
  consoleGuardRuntime.startTestWindow();
});

afterEach(async () => {
  await consoleGuardRuntime.assertCurrentWindowClean();
});

afterAll(async () => {
  try {
    await consoleGuardRuntime.assertCurrentWindowClean({ gracePeriodMs: 25 });
  } finally {
    consoleGuardRuntime.restore();
  }
});
