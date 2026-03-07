export const ORGANIZATION_HEADER_NAME = 'X-Organization-Id';

export function normalizeOrganizationId(
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveOrganizationIdFromHeaders(
  headers: Record<string, string>
): string | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === ORGANIZATION_HEADER_NAME.toLowerCase()) {
      return normalizeOrganizationId(value);
    }
  }

  return null;
}
