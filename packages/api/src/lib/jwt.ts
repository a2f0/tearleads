import { isRecord } from '@rapid/shared';
import jwt from 'jsonwebtoken';

export type JwtClaims = {
  sub: string;
  email?: string;
  jti: string;
};

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

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256']
    });

    if (!isRecord(decoded)) {
      return null;
    }

    const sub = decoded['sub'];
    const email = decoded['email'];
    const jti = decoded['jti'];

    if (typeof sub !== 'string' || typeof jti !== 'string') {
      return null;
    }

    if (email !== undefined && typeof email !== 'string') {
      return null;
    }

    const claims: JwtClaims = {
      sub,
      jti
    };

    if (typeof email === 'string') {
      claims.email = email;
    }

    return claims;
  } catch {
    return null;
  }
}
