function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error('apiBaseUrl is required');
  }

  if (trimmed.endsWith('/')) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

export function toConnectBaseUrl(apiBaseUrl: string): string {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (normalizedApiBaseUrl.endsWith('/connect')) {
    return normalizedApiBaseUrl;
  }
  return `${normalizedApiBaseUrl}/connect`;
}

export function normalizeBearerToken(
  token: string | null | undefined
): string | null {
  if (!token) {
    return null;
  }
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!trimmed.startsWith('Bearer ')) {
    return trimmed;
  }
  const withoutPrefix = trimmed.slice('Bearer '.length).trim();
  return withoutPrefix.length > 0 ? withoutPrefix : null;
}
