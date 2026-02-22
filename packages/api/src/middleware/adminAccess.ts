import type { NextFunction, Request, Response } from 'express';
import { getPostgresPool } from '../lib/postgres.js';
import type { SessionData } from '../lib/sessions.js';

type AdminAccessContext = {
  isRootAdmin: boolean;
  organizationIds: string[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminAccess?: AdminAccessContext;
    }
  }
}

async function getOrganizationAdminIds(userId: string): Promise<string[]> {
  const pool = await getPostgresPool();
  const result = await pool.query<{ organization_id: string }>(
    `SELECT organization_id
       FROM user_organizations
       WHERE user_id = $1
         AND is_admin = TRUE
       ORDER BY organization_id`,
    [userId]
  );

  return result.rows.map((row) => row.organization_id);
}

export async function adminAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const session = (req as Request & { session?: SessionData }).session;
  const claims = req.authClaims;

  if (!session || !claims || session.userId !== claims.sub) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (session.admin) {
    req.adminAccess = { isRootAdmin: true, organizationIds: [] };
    next();
    return;
  }

  try {
    const organizationIds = await getOrganizationAdminIds(session.userId);
    if (organizationIds.length === 0) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    req.adminAccess = { isRootAdmin: false, organizationIds };
    next();
  } catch (error) {
    console.error('Admin access middleware failed:', error);
    res.status(500).json({ error: 'Failed to authorize admin access' });
  }
}

export function requireRootAdmin(req: Request, res: Response): boolean {
  const access = req.adminAccess;
  if (!access || !access.isRootAdmin) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function canAccessOrganization(
  req: Request,
  organizationId: string
): boolean {
  const access = req.adminAccess;
  if (!access) {
    return false;
  }
  if (access.isRootAdmin) {
    return true;
  }
  return access.organizationIds.includes(organizationId);
}

export function ensureOrganizationAccess(
  req: Request,
  res: Response,
  organizationId: string
): boolean {
  if (!canAccessOrganization(req, organizationId)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function parseOrganizationIdQuery(
  req: Request,
  res: Response
): string | null | undefined {
  const raw = req.query['organizationId'];
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string') {
    res.status(400).json({ error: 'organizationId query must be a string' });
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    res.status(400).json({ error: 'organizationId query cannot be empty' });
    return undefined;
  }
  return trimmed;
}
