export function mergeHeaders(
  authToken: string,
  extraHeaders?: RequestInit['headers'],
  organizationId?: string
): Headers {
  const merged = new Headers({ Authorization: `Bearer ${authToken}` });
  if (organizationId) {
    merged.set('X-Organization-Id', organizationId);
  }
  if (extraHeaders) {
    const provided = new Headers(extraHeaders);
    for (const [key, value] of provided.entries()) {
      merged.set(key, value);
    }
  }
  return merged;
}

export function resolveDirectApiPath(path: string): string {
  if (path.startsWith('/v1/')) {
    return path;
  }
  return `/v1${path}`;
}
