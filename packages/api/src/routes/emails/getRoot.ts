import { getRedisClient } from '@tearleads/shared/redis';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getEmailStorageBackend } from './backend.js';
import {
  type EmailListItem,
  extractSubject,
  formatEmailAddress,
  getEmailKey,
  getEmailListKey,
  type StoredEmail
} from './shared.js';

/**
 * @openapi
 * /emails:
 *   get:
 *     summary: List emails with pagination
 *     description: Returns a paginated list of stored emails with parsed metadata
 *     tags:
 *       - Emails
 *     parameters:
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of emails to skip
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of emails to return
 *     responses:
 *       200:
 *         description: List of emails
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 emails:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       from:
 *                         type: string
 *                       to:
 *                         type: array
 *                         items:
 *                           type: string
 *                       subject:
 *                         type: string
 *                       receivedAt:
 *                         type: string
 *                       size:
 *                         type: number
 *                 total:
 *                   type: integer
 *                   description: Total number of emails
 *                 offset:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       500:
 *         description: Server error
 */
const getRootHandler = async (req: Request, res: Response) => {
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
    const backend = getEmailStorageBackend();

    if (backend === 'vfs') {
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
           em.ciphertext_size
         FROM emails e
         INNER JOIN vfs_registry vr ON vr.id = e.id
         LEFT JOIN email_messages em ON em.storage_key = e.encrypted_body_path
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
          ? row.encrypted_to
              .filter((value): value is string => typeof value === 'string')
          : [],
        subject: row.encrypted_subject ?? '',
        receivedAt: row.received_at,
        size: row.ciphertext_size ?? 0
      }));

      res.json({ emails, total, offset, limit });
      return;
    }

    const client = await getRedisClient();
    const emailListKey = getEmailListKey(userId);
    const total = await client.lLen(emailListKey);
    const emailIds = await client.lRange(
      emailListKey,
      offset,
      offset + limit - 1
    );

    if (emailIds.length === 0) {
      res.json({ emails: [], total, offset, limit });
      return;
    }

    const keys = emailIds.map((id) => getEmailKey(id));
    const results = await client.mGet(keys);

    const emails: EmailListItem[] = [];
    for (let i = 0; i < results.length; i++) {
      const data = results[i];
      if (data) {
        try {
          const email: StoredEmail = JSON.parse(data);
          emails.push({
            id: email.id,
            from: formatEmailAddress(email.envelope.mailFrom),
            to: email.envelope.rcptTo.map((r) => r.address),
            subject: extractSubject(email.rawData),
            receivedAt: email.receivedAt,
            size: email.size
          });
        } catch (parseError) {
          console.error(
            `Failed to parse email data for id ${emailIds[i]}:`,
            parseError
          );
        }
      }
    }

    res.json({ emails, total, offset, limit });
  } catch (error) {
    console.error('Failed to list emails:', error);
    res.status(500).json({ error: 'Failed to list emails' });
  }
};

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}
