import { OPAQUE_IDENTIFIER_PATTERN, UUID_PATTERN } from '@tearleads/shared';

export function parseIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return UUID_PATTERN.test(trimmed) || OPAQUE_IDENTIFIER_PATTERN.test(trimmed)
    ? trimmed
    : null;
}

export function parseInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}
