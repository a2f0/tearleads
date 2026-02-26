import type { VfsRekeyRequest, VfsRekeyResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

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

  if (
    typeof newEpoch !== 'number' ||
    !Number.isInteger(newEpoch) ||
    !Number.isSafeInteger(newEpoch) ||
    newEpoch < 1
  ) {
    return null;
  }

  if (!Array.isArray(wrappedKeys)) {
    return null;
  }

  for (const key of wrappedKeys) {
    if (typeof key !== 'object' || key === null) {
      return null;
    }
    const keyRecord = key as Record<string, unknown>;
    const recipientUserId = keyRecord['recipientUserId'];
    const recipientPublicKeyId = keyRecord['recipientPublicKeyId'];
    const keyEpoch = keyRecord['keyEpoch'];
    const encryptedKey = keyRecord['encryptedKey'];
    const senderSignature = keyRecord['senderSignature'];

    if (
      !isNonEmptyString(recipientUserId) ||
      !isNonEmptyString(recipientPublicKeyId) ||
      typeof keyEpoch !== 'number' ||
      !Number.isInteger(keyEpoch) ||
      !Number.isSafeInteger(keyEpoch) ||
      keyEpoch < 1 ||
      !isNonEmptyString(encryptedKey) ||
      !isNonEmptyString(senderSignature)
    ) {
      return null;
    }

    if (keyEpoch !== newEpoch) {
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
const postItemsItemIdRekeyHandler = async (
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
      error:
        'Invalid request payload. Please check the `reason`, `newEpoch`, and `wrappedKeys` fields.'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const rekeyablePrincipalTypes = ['user', 'group', 'organization'];
    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query('BEGIN');
      transactionOpen = true;

      // Verify item exists and user is owner while holding a transaction-bound lock.
      const itemResult = await client.query<{
        id: string;
        owner_id: string | null;
      }>('SELECT id, owner_id FROM vfs_registry WHERE id = $1 FOR UPDATE', [
        itemId
      ]);
      const item = itemResult.rows[0];

      if (!item) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      if (item.owner_id !== claims.sub) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        res.status(403).json({ error: 'Not authorized to rekey this item' });
        return;
      }

      const wrappedKeyMetadata = payload.wrappedKeys.map((wrap) =>
        JSON.stringify({
          recipientPublicKeyId: wrap.recipientPublicKeyId,
          senderSignature: wrap.senderSignature
        })
      );

      // Apply all recipient updates in one statement to avoid one query per wrapped key.
      const updateResult = await client.query(
        `WITH input_rows AS (
           SELECT recipient_user_id, wrapped_session_key, wrapped_hierarchical_key, key_epoch
           FROM UNNEST(
             $1::text[],
             $2::text[],
             $3::text[],
             $4::int4[]
           ) AS rekey_rows(
             recipient_user_id,
             wrapped_session_key,
             wrapped_hierarchical_key,
             key_epoch
           )
         )
         UPDATE vfs_acl_entries AS acl
         SET wrapped_session_key = input_rows.wrapped_session_key,
             wrapped_hierarchical_key = input_rows.wrapped_hierarchical_key,
             key_epoch = input_rows.key_epoch,
             updated_at = NOW()
         FROM input_rows
         WHERE acl.item_id = $5
           AND acl.principal_id = input_rows.recipient_user_id
           AND acl.principal_type = ANY($6::text[])
           AND acl.revoked_at IS NULL
         RETURNING acl.id`,
        [
          payload.wrappedKeys.map((wrap) => wrap.recipientUserId),
          payload.wrappedKeys.map((wrap) => wrap.encryptedKey),
          wrappedKeyMetadata,
          payload.wrappedKeys.map((wrap) => wrap.keyEpoch),
          itemId,
          rekeyablePrincipalTypes
        ]
      );
      const wrapsApplied = updateResult.rowCount ?? 0;

      await client.query('COMMIT');
      transactionOpen = false;

      const response: VfsRekeyResponse = {
        itemId,
        newEpoch: payload.newEpoch,
        wrapsApplied
      };

      res.status(200).json(response);
    } catch (transactionError) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            'Failed to rollback VFS rekey transaction:',
            rollbackError
          );
        }
      }
      throw transactionError;
    } finally {
      client.release();
    }
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
