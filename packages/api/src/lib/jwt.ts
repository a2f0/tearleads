import { isRecord } from '@rapid/shared';
import jwt from 'jsonwebtoken';

export type JwtClaims = {
  sub: string;
  email?: string;
  jti: string;
};

export type RefreshTokenClaims = {
  sub: string;
  jti: string;
  sid: string;
  type: 'refresh';
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

export function verifyRefreshJwt(
  token: string,
  secret: string
): RefreshTokenClaims | null {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256']
    });

    if (!isRecord(decoded)) {
      return null;
    }

    const sub = decoded['sub'];
    const jti = decoded['jti'];
    const sid = decoded['sid'];
    const type = decoded['type'];

    if (
      typeof sub !== 'string' ||
      typeof jti !== 'string' ||
      typeof sid !== 'string' ||
      type !== 'refresh'
    ) {
      return null;
    }

    return { sub, jti, sid, type };
  } catch {
    return null;
  }
}
