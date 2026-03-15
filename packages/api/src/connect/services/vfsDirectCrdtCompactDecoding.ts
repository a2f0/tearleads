import { OPAQUE_IDENTIFIER_PATTERN } from '@tearleads/shared';

/** Server-side UUID pattern is case-insensitive (accepts A-F from clients). */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

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
