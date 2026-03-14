const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;
const OPAQUE_IDENTIFIER_PATTERN = /^[a-z0-9:-]+$/u;

function isOpaqueIdentifier(value: string): boolean {
  return OPAQUE_IDENTIFIER_PATTERN.test(value);
}

export function parseIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return UUID_PATTERN.test(trimmed) || isOpaqueIdentifier(trimmed)
    ? trimmed
    : null;
}

export function parseInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}
