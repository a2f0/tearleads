import type { NextFunction, Request, Response } from 'express';
import type { JwtClaims } from '../lib/jwt.js';
import { verifyJwt } from '../lib/jwt.js';
import {
  getSession,
  type SessionData,
  updateSessionActivity
} from '../lib/sessions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authClaims?: JwtClaims;
      session?: SessionData;
    }
  }
}

const AUTH_HEADER_PREFIX = 'Bearer ';

const isAuthExemptPath = (path: string): boolean => {
  if (path === '/ping') return true;
  if (path === '/auth/login') return true;
  if (path === '/auth/register') return true;
  if (path === '/auth/refresh') return true;
  return false;
};

const extractBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader || !authHeader.startsWith(AUTH_HEADER_PREFIX)) {
    return null;
  }
  const token = authHeader.slice(AUTH_HEADER_PREFIX.length).trim();
  return token ? token : null;
};

const extractAuthToken = (req: Request): string | null => {
  const bearerToken = extractBearerToken(req.get('authorization'));
  if (bearerToken) {
    return bearerToken;
  }

  const legacyToken = req.get('x-auth-token')?.trim();
  return legacyToken ? legacyToken : null;
};

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (isAuthExemptPath(req.path)) {
    next();
    return;
  }

  const token = extractAuthToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    console.error('Authentication setup error: JWT_SECRET is not configured.');
    res.status(500).json({ error: 'Failed to authenticate' });
    return;
  }

  const claims = verifyJwt(token, jwtSecret);
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const session = await getSession(claims.jti);
    if (!session || session.userId !== claims.sub) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    req.authClaims = claims;
    req.session = session;

    void updateSessionActivity(claims.jti);

    next();
  } catch (error) {
    console.error('Auth middleware failed:', error);
    res.status(500).json({ error: 'Failed to authenticate' });
  }
}
