import type { NextFunction, Request, Response } from 'express';
import { getPostgresPool } from '../lib/postgres.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      organizationId?: string;
    }
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXEMPT_PATHS = new Set([
  '/ping',
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/revenuecat/webhooks'
]);

const isExemptPath = (path: string): boolean => {
  return EXEMPT_PATHS.has(path) || path.startsWith('/admin/');
};

export async function orgMembershipMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (isExemptPath(req.path)) {
    next();
    return;
  }

  const orgId = req.get('X-Organization-Id');
  if (!orgId) {
    next();
    return;
  }

  if (!UUID_REGEX.test(orgId)) {
    res.status(400).json({ error: 'Invalid X-Organization-Id format' });
    return;
  }

  const userId = req.authClaims?.sub;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [userId, orgId]
    );

    if (result.rows.length === 0) {
      res
        .status(403)
        .json({ error: 'Not a member of the specified organization' });
      return;
    }

    req.organizationId = orgId;
    next();
  } catch (error) {
    console.error('Org membership middleware failed:', error);
    res.status(500).json({ error: 'Failed to verify organization membership' });
  }
}
