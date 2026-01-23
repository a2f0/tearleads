import type { NextFunction, Request, Response } from 'express';
import type { SessionData } from '../lib/sessions.js';

export function adminSessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const session = (req as Request & { session?: SessionData }).session;
  if (!session || !session.admin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}
