import { afterEach } from 'vitest';

const originalValues = new Map<string, string | undefined>();

export function setTestEnv(key: string, value: string): void {
  if (!originalValues.has(key)) {
    const currentValue = process.env[key];
    originalValues.set(
      key,
      typeof currentValue === 'string' ? currentValue : undefined
    );
  }

  process.env[key] = value;
}

function resetTestEnv(): void {
  for (const [key, originalValue] of originalValues.entries()) {
    if (typeof originalValue === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }

  originalValues.clear();
}

afterEach(() => {
  resetTestEnv();
});
