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
  // Sync import.meta.env so freshly-imported modules see the new value
  // (Vitest populates import.meta.env from process.env at startup but
  // does not mirror later mutations automatically.)
  import.meta.env[key] = value;
}

function resetTestEnv(): void {
  for (const [key, originalValue] of originalValues.entries()) {
    if (typeof originalValue === 'undefined') {
      delete process.env[key];
      delete import.meta.env[key];
    } else {
      process.env[key] = originalValue;
      import.meta.env[key] = originalValue;
    }
  }

  originalValues.clear();
}

afterEach(() => {
  resetTestEnv();
});
