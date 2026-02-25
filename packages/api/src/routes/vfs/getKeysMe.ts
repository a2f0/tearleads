import type { VfsUserKeysResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /vfs/keys/me:
 *   get:
 *     summary: Get current user's VFS public keys
 *     description: Returns the public encryption and signing keys for the authenticated user.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's public keys
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 publicEncryptionKey:
 *                   type: string
 *                 publicSigningKey:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User has not set up VFS keys
 *       500:
 *         description: Server error
 */
const getKeysMeHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      public_encryption_key: string;
      public_signing_key: string;
      encrypted_private_keys: string;
      argon2_salt: string;
    }>(
      `SELECT public_encryption_key,
              public_signing_key,
              encrypted_private_keys,
              argon2_salt
       FROM user_keys
       WHERE user_id = $1`,
      [claims.sub]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'VFS keys not set up' });
      return;
    }

    const response: VfsUserKeysResponse = {
      publicEncryptionKey: row.public_encryption_key,
      publicSigningKey: row.public_signing_key,
      encryptedPrivateKeys: row.encrypted_private_keys,
      argon2Salt: row.argon2_salt
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get VFS keys:', error);
    res.status(500).json({ error: 'Failed to get VFS keys' });
  }
};

export function registerGetKeysMeRoute(routeRouter: RouterType): void {
  routeRouter.get('/keys/me', getKeysMeHandler);
}
