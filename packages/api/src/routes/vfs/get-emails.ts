import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

interface EmailListItem {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  size: number;
}

/**
 * @openapi
 * /vfs/emails:
 *   get:
 *     summary: List emails via canonical VFS-backed metadata
 *     description: Returns a paginated list of email items owned by the authenticated user.
 *     tags:
 *       - VFS
 *     parameters:
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: List of emails
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const getEmailsHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const offset = Math.max(
      0,
      parseInt(req.query['offset'] as string, 10) || 0
    );
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query['limit'] as string, 10) || 50)
    );

    const pool = await getPostgresPool();
    const totalResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM emails e
         INNER JOIN vfs_registry vr ON vr.id = e.id
         WHERE vr.owner_id = $1`,
      [userId]
    );
    const total = parseInt(totalResult.rows[0]?.total ?? '0', 10) || 0;

    const rows = await pool.query<{
      id: string;
      encrypted_from: string | null;
      encrypted_to: unknown;
      encrypted_subject: string | null;
      received_at: string;
      ciphertext_size: number | null;
    }>(
      `SELECT
           e.id,
           e.encrypted_from,
           e.encrypted_to,
           e.encrypted_subject,
           e.received_at,
           e.ciphertext_size
         FROM emails e
         INNER JOIN vfs_registry vr ON vr.id = e.id
         WHERE vr.owner_id = $1
         ORDER BY e.received_at DESC
         OFFSET $2
         LIMIT $3`,
      [userId, offset, limit]
    );

    const emails: EmailListItem[] = rows.rows.map((row) => ({
      id: row.id,
      from: row.encrypted_from ?? '',
      to: Array.isArray(row.encrypted_to)
        ? row.encrypted_to.filter(
            (value): value is string => typeof value === 'string'
          )
        : [],
      subject: row.encrypted_subject ?? '',
      receivedAt: row.received_at,
      size: row.ciphertext_size ?? 0
    }));

    res.json({ emails, total, offset, limit });
  } catch (error) {
    console.error('Failed to list VFS emails:', error);
    res.status(500).json({ error: 'Failed to list emails' });
  }
};

export function registerGetEmailsRoute(routeRouter: RouterType): void {
  routeRouter.get('/emails', getEmailsHandler);
}
