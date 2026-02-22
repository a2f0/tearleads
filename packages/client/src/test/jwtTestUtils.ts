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
