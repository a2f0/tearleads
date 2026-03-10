import { afterEach } from 'vitest';

const originalValues = new Map<string, string | undefined>();
const touchedKeys = new Set<string>();

export function setTestEnv(key: string, value: string): void {
  if (!originalValues.has(key)) {
    const currentValue = process.env[key];
    originalValues.set(
      key,
      typeof currentValue === 'string' ? currentValue : undefined
    );
  }

  process.env[key] = value;
  touchedKeys.add(key);
}

export function unsetTestEnv(key: string): void {
  if (!originalValues.has(key)) {
    const currentValue = process.env[key];
    originalValues.set(
      key,
      typeof currentValue === 'string' ? currentValue : undefined
    );
  }

  delete process.env[key];
  touchedKeys.add(key);
}

export function resetTestEnv(): void {
  for (const key of touchedKeys) {
    const originalValue = originalValues.get(key);

    if (typeof originalValue === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }

  touchedKeys.clear();
  originalValues.clear();
}

afterEach(() => {
  resetTestEnv();
});
