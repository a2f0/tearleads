import { vi } from 'vitest';

export function withHoisted<T>(factory: () => T): T {
  const hoisted = vi.hoisted;
  if (typeof hoisted === 'function') {
    return hoisted(factory);
  }
  return factory();
}
