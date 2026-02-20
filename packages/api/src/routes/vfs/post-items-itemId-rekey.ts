import type { VfsRekeyRequest, VfsRekeyResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * Parse and validate the rekey request payload.
 */
function parseRekeyPayload(body: unknown): VfsRekeyRequest | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const { reason, newEpoch, wrappedKeys } = body as Record<string, unknown>;

  if (
    typeof reason !== 'string' ||
    !['unshare', 'expiry', 'manual'].includes(reason)
  ) {
    return null;
  }

  if (typeof newEpoch !== 'number' || newEpoch < 1) {
    return null;
  }

  if (!Array.isArray(wrappedKeys)) {
    return null;
  }

  for (const key of wrappedKeys) {
    if (typeof key !== 'object' || key === null) {
      return null;
    }
    const {
      recipientUserId,
      recipientPublicKeyId,
      keyEpoch,
      encryptedKey,
      senderSignature
    } = key as Record<string, unknown>;

    if (
      typeof recipientUserId !== 'string' ||
      typeof recipientPublicKeyId !== 'string' ||
      typeof keyEpoch !== 'number' ||
      typeof encryptedKey !== 'string' ||
      typeof senderSignature !== 'string'
    ) {
      return null;
    }
  }

  return {
    reason: reason as 'unshare' | 'expiry' | 'manual',
    newEpoch,
    wrappedKeys: wrappedKeys as VfsRekeyRequest['wrappedKeys']
  };
}

/**
 * @openapi
 * /vfs/items/{itemId}/rekey:
 *   post:
 *     summary: Rotate the encryption key for a VFS item
 *     description: |
 *       Rotates the item's encryption key to a new epoch and persists
 *       wrapped keys for all active share recipients. Only the item
 *       owner can perform this operation.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *         description: The VFS item ID to rekey
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *               - newEpoch
 *               - wrappedKeys
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: [unshare, expiry, manual]
 *                 description: Reason for key rotation
 *               newEpoch:
 *                 type: integer
 *                 minimum: 1
 *                 description: The new key epoch number
 *               wrappedKeys:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - recipientUserId
 *                     - recipientPublicKeyId
 *                     - keyEpoch
 *                     - encryptedKey
 *                     - senderSignature
 *                   properties:
 *                     recipientUserId:
 *                       type: string
 *                     recipientPublicKeyId:
 *                       type: string
 *                     keyEpoch:
 *                       type: integer
 *                     encryptedKey:
 *                       type: string
 *                       description: HPKE-encrypted session key (base64)
 *                     senderSignature:
 *                       type: string
 *                       description: Sender signature over wrapped key (base64)
 *     responses:
 *       200:
 *         description: Key rotation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 itemId:
 *                   type: string
 *                 newEpoch:
 *                   type: integer
 *                 wrapsApplied:
 *                   type: integer
 *       400:
 *         description: Invalid request payload or stale epoch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorized to rekey this item
 *       404:
 *         description: Item not found
 *       500:
 *         description: Server error
 */
export const postItemsItemIdRekeyHandler = async (
  req: Request<{ itemId: string }>,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { itemId } = req.params;
  if (!itemId) {
    res.status(400).json({ error: 'itemId is required' });
    return;
  }

  const payload = parseRekeyPayload(req.body);
  if (!payload) {
    res.status(400).json({
      error: 'reason, newEpoch, and wrappedKeys are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Verify item exists and user is owner
    const itemResult = await pool.query<{
      id: string;
      owner_id: string | null;
    }>('SELECT id, owner_id FROM vfs_registry WHERE id = $1', [itemId]);

    if (!itemResult.rows[0]) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    if (itemResult.rows[0].owner_id !== claims.sub) {
      res.status(403).json({ error: 'Not authorized to rekey this item' });
      return;
    }

    // Update wrapped keys for each recipient in the ACL
    let wrapsApplied = 0;

    for (const wrap of payload.wrappedKeys) {
      // Find active ACL entry for this recipient
      const result = await pool.query(
        `UPDATE vfs_acl_entries
         SET wrapped_session_key = $1,
             key_epoch = $2,
             updated_at = NOW()
         WHERE item_id = $3
           AND principal_type = 'user'
           AND principal_id = $4
           AND revoked_at IS NULL
         RETURNING id`,
        [wrap.encryptedKey, wrap.keyEpoch, itemId, wrap.recipientUserId]
      );

      if (result.rowCount && result.rowCount > 0) {
        wrapsApplied += result.rowCount;
      }
    }

    const response: VfsRekeyResponse = {
      itemId,
      newEpoch: payload.newEpoch,
      wrapsApplied
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Failed to rekey VFS item:', error);
    res.status(500).json({ error: 'Failed to rekey VFS item' });
  }
};

export function registerPostItemsItemIdRekeyRoute(
  routeRouter: RouterType
): void {
  routeRouter.post('/items/:itemId/rekey', postItemsItemIdRekeyHandler);
}
