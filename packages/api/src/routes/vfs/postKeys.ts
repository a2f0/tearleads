import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseKeySetupPayload } from './shared.js';

/**
 * @openapi
 * /vfs/keys:
 *   post:
 *     summary: Set up VFS keys for current user
 *     description: Stores the user's VFS keypair. Can only be called once per user.
 *     tags:
 *       - VFS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               publicEncryptionKey:
 *                 type: string
 *               publicSigningKey:
 *                 type: string
 *               encryptedPrivateKeys:
 *                 type: string
 *               argon2Salt:
 *                 type: string
 *             required:
 *               - publicEncryptionKey
 *               - publicSigningKey
 *               - encryptedPrivateKeys
 *               - argon2Salt
 *     responses:
 *       201:
 *         description: Keys stored successfully
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Keys already exist for this user
 *       500:
 *         description: Server error
 */
const postKeysHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseKeySetupPayload(req.body);
  if (!payload) {
    res.status(400).json({
      error:
        'publicEncryptionKey, publicSigningKey, encryptedPrivateKeys, and argon2Salt are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const existing = await pool.query(
      'SELECT 1 FROM user_keys WHERE user_id = $1',
      [claims.sub]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'VFS keys already exist for this user' });
      return;
    }

    await pool.query(
      `INSERT INTO user_keys (
        user_id,
        public_encryption_key,
        public_signing_key,
        encrypted_private_keys,
        argon2_salt,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        claims.sub,
        payload.publicEncryptionKey,
        payload.publicSigningKey,
        payload.encryptedPrivateKeys,
        payload.argon2Salt
      ]
    );

    res.status(201).json({ created: true });
  } catch (error) {
    console.error('Failed to set up VFS keys:', error);
    res.status(500).json({ error: 'Failed to set up VFS keys' });
  }
};

export function registerPostKeysRoute(routeRouter: RouterType): void {
  routeRouter.post('/keys', postKeysHandler);
}
