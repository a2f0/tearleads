import jwt from 'jsonwebtoken';

export function createJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number
): string {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds
  });
}
