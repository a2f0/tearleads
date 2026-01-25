/**
 * Decode a JWT token without verification.
 * Used client-side to read claims like expiration.
 */
export function decodeJwt(token: string): Record<string, unknown> | null {
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

/**
 * Get the expiration timestamp from a JWT token.
 * Returns the Unix timestamp (seconds) or null if not present.
 */
export function getJwtExpiration(token: string): number | null {
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

/**
 * Check if a JWT token is expired.
 * Returns true if expired or if expiration cannot be determined.
 */
export function isJwtExpired(token: string): boolean {
  const exp = getJwtExpiration(token);
  if (exp === null) {
    return true;
  }
  return Date.now() / 1000 > exp;
}

/**
 * Get the time remaining until a JWT token expires.
 * Returns milliseconds remaining, or null if expired/invalid.
 */
export function getJwtTimeRemaining(token: string): number | null {
  const exp = getJwtExpiration(token);
  if (exp === null) {
    return null;
  }
  const remaining = exp * 1000 - Date.now();
  return remaining > 0 ? remaining : null;
}
