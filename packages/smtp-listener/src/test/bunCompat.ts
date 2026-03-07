import { setTimeout as delay } from 'node:timers/promises';
import { vi } from 'vitest';

export function resetModulesIfSupported(): void {
  const resetModules = vi.resetModules;
  if (typeof resetModules === 'function') {
    resetModules();
  }
}

export async function waitForAssertion(
  assertion: () => void,
  options: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<void> {
  const waitFor = vi.waitFor;
  if (typeof waitFor === 'function') {
    await waitFor(assertion);
    return;
  }

  const intervalMs = options.intervalMs ?? 10;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('waitForAssertion timed out');
}
