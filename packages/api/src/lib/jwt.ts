import { isRecord } from '@tearleads/shared';
import jwt from 'jsonwebtoken';

export type JwtClaims = {
  sub: string;
  email?: string;
  jti: string;
  /** App identifier for white-label apps */
  app?: string;
};

type RefreshTokenClaims = {
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

function verifyAndValidate<T>(
  token: string,
  secret: string,
  validator: (decoded: Record<string, unknown>) => T | null
): T | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!isRecord(decoded)) {
      return null;
    }
    return validator(decoded);
  } catch {
    return null;
  }
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  return verifyAndValidate(token, secret, (decoded) => {
    const sub = decoded['sub'];
    const email = decoded['email'];
    const jti = decoded['jti'];
    const app = decoded['app'];

    if (typeof sub !== 'string' || typeof jti !== 'string') {
      return null;
    }

    if (email !== undefined && typeof email !== 'string') {
      return null;
    }

    if (app !== undefined && typeof app !== 'string') {
      return null;
    }

    const claims: JwtClaims = { sub, jti };
    if (typeof email === 'string') {
      claims.email = email;
    }
    if (typeof app === 'string') {
      claims.app = app;
    }
    return claims;
  });
}

export function verifyRefreshJwt(
  token: string,
  secret: string
): RefreshTokenClaims | null {
  return verifyAndValidate(token, secret, (decoded) => {
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
  });
}
