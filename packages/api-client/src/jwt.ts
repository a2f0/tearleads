function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    if (!payload) {
      return null;
    }
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getJwtExpiration(token: string): number | null {
  const claims = decodeJwt(token);
  if (!claims) {
    return null;
  }
  const exp = claims['exp'];
  if (typeof exp !== 'number') {
    return null;
  }
  return exp;
}

export function isJwtExpired(token: string): boolean {
  const exp = getJwtExpiration(token);
  if (exp === null) {
    return true;
  }
  return Date.now() / 1000 > exp;
}
