import { describe, expect, it, vi } from 'vitest';
import { cn, generateUniqueId } from './utils.js';

describe('utils', () => {
  it('merges class names', () => {
    expect(cn('p-2', 'p-4', 'text-sm')).toBe('p-4 text-sm');
  });

  it('uses crypto.randomUUID when available', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'crypto'
    );
    const randomUUID = vi.fn(() => 'uuid-123');

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID }
    });

    expect(generateUniqueId('window')).toBe('window-uuid-123');
    expect(randomUUID).toHaveBeenCalledTimes(1);

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });

  it('falls back when crypto is unavailable', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'crypto'
    );

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined
    });

    const id = generateUniqueId('window');
    expect(id.startsWith('window-')).toBe(true);

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });
});
