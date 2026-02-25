import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { deleteVfsBlobByStorageKey } from '../../lib/vfsBlobStore.js';

/**
 * @openapi
 * /vfs/emails/{id}:
 *   delete:
 *     summary: Delete an email item and cleanup orphaned inbound message data
 *     tags:
 *       - VFS
 *     responses:
 *       200:
 *         description: Email deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Email not found
 *       500:
 *         description: Server error
 */
const deleteEmailsIdHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const pool = await getPostgresPool();
    const client = await pool.connect();
    let orphanedStorageKey: string | null = null;

    try {
      await client.query('BEGIN');
      const emailRowResult = await client.query<{ storage_key: string | null }>(
        `SELECT
             e.encrypted_body_path AS storage_key
           FROM vfs_registry vr
           INNER JOIN emails e ON e.id = vr.id
           WHERE vr.id = $1
             AND vr.owner_id = $2
             AND vr.object_type = 'email'
           LIMIT 1`,
        [id, userId]
      );

      const emailRow = emailRowResult.rows[0];
      if (!emailRow) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      const deleted = await client.query<{ id: string }>(
        `DELETE FROM vfs_registry
           WHERE id = $1
             AND owner_id = $2
             AND object_type = 'email'
           RETURNING id`,
        [id, userId]
      );

      if (!deleted.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      if (emailRow.storage_key) {
        const remainingItems = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM emails
             WHERE encrypted_body_path = $1`,
          [emailRow.storage_key]
        );

        const remainingCount =
          parseInt(remainingItems.rows[0]?.count ?? '0', 10) || 0;
        if (remainingCount === 0) {
          orphanedStorageKey = emailRow.storage_key;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Failed to rollback VFS email delete transaction:',
          rollbackError
        );
      }
      throw error;
    } finally {
      client.release();
    }

    if (orphanedStorageKey) {
      try {
        await deleteVfsBlobByStorageKey({ storageKey: orphanedStorageKey });
      } catch (blobDeleteError) {
        // Blob cleanup is best-effort after successful metadata deletion.
        console.error(
          'Failed to delete orphaned inbound email blob:',
          blobDeleteError
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete VFS email:', error);
    res.status(500).json({ error: 'Failed to delete email' });
  }
};

export function registerDeleteEmailsIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/emails/:id', deleteEmailsIdHandler);
}
