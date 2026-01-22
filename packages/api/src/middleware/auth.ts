import { verifyJwt } from '../lib/jwt.js';
import { getSession } from '../lib/sessions.js';
import type { NextFunction, Request, Response } from 'express';

const AUTH_HEADER_PREFIX = 'Bearer ';

const isAuthExemptPath = (path: string): boolean => {
  return path === '/ping' || path.startsWith('/auth');
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

  const authHeader = req.get('authorization');
  if (!authHeader || !authHeader.startsWith(AUTH_HEADER_PREFIX)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(AUTH_HEADER_PREFIX.length).trim();
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

    next();
  } catch (error) {
    console.error('Auth middleware failed:', error);
    res.status(500).json({ error: 'Failed to authenticate' });
  }
}
