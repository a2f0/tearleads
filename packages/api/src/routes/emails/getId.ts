import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /emails/{id}:
 *   get:
 *     summary: Get email by ID
 *     description: Returns a single email with full raw data
 *     tags:
 *       - Emails
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Email ID
 *     responses:
 *       200:
 *         description: Email details
 *       404:
 *         description: Email not found
 *       500:
 *         description: Server error
 */
const getIdHandler = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;

    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      encrypted_from: string | null;
      encrypted_to: unknown;
      encrypted_subject: string | null;
      received_at: string;
      ciphertext_size: number | null;
      encrypted_body_path: string | null;
    }>(
      `SELECT
           e.id,
           e.encrypted_from,
           e.encrypted_to,
           e.encrypted_subject,
           e.received_at,
           e.encrypted_body_path,
           em.ciphertext_size
         FROM emails e
         INNER JOIN vfs_registry vr ON vr.id = e.id
         LEFT JOIN email_messages em ON em.storage_key = e.encrypted_body_path
         WHERE e.id = $1
           AND vr.owner_id = $2
         LIMIT 1`,
      [id, userId]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    const encryptedTo = Array.isArray(row.encrypted_to)
      ? row.encrypted_to.filter(
          (value): value is string => typeof value === 'string'
        )
      : [];

    res.json({
      id: row.id,
      from: row.encrypted_from ?? '',
      to: encryptedTo,
      subject: row.encrypted_subject ?? '',
      receivedAt: row.received_at,
      size: row.ciphertext_size ?? 0,
      rawData: '',
      encryptedBodyPath: row.encrypted_body_path ?? null
    });
  } catch (error) {
    console.error('Failed to get email:', error);
    res.status(500).json({ error: 'Failed to get email' });
  }
};

export function registerGetIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id', getIdHandler);
}
