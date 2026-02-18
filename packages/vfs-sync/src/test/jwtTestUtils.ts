/**
 * Creates a test JWT token with the specified expiration.
 * For testing purposes only - the signature is not cryptographically valid.
 *
 * @param exp - Unix timestamp in seconds for the token expiration
 * @returns A JWT-formatted string
 */
export function createTestJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: 'user123', exp }));
  const signature = 'test-signature';
  return `${header}.${payload}.${signature}`;
}

/**
 * Creates a test JWT token that expires in the specified number of seconds.
 * For testing purposes only - the signature is not cryptographically valid.
 *
 * @param expInSeconds - Number of seconds from now until expiration (can be negative for expired)
 * @returns A JWT-formatted string
 */
export function createTestJwtExpiresIn(expInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expInSeconds;
  return createTestJwt(exp);
}
