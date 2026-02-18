import type { VfsRegisterResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseRegisterPayload } from './shared.js';

/**
 * @openapi
 * /vfs/register:
 *   post:
 *     summary: Register an item in the VFS registry
 *     description: Creates a VFS registry entry for a file, folder, contact, or other object.
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
 *               id:
 *                 type: string
 *                 description: Unique identifier for the VFS item
 *               objectType:
 *                 type: string
 *                 enum: [file, blob, folder, contact, note, photo]
 *               encryptedSessionKey:
 *                 type: string
 *                 description: Session key encrypted with user's public key
 *             required:
 *               - id
 *               - objectType
 *               - encryptedSessionKey
 *     responses:
 *       201:
 *         description: Item registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Item already registered
 *       500:
 *         description: Server error
 */
export const postRegisterHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseRegisterPayload(req.body);
  if (!payload) {
    res.status(400).json({
      error: 'id, objectType, and encryptedSessionKey are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const existing = await pool.query(
      'SELECT 1 FROM vfs_registry WHERE id = $1',
      [payload.id]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Item already registered in VFS' });
      return;
    }

    const result = await pool.query<{ created_at: Date }>(
      `INSERT INTO vfs_registry (
        id,
        object_type,
        owner_id,
        encrypted_session_key,
        created_at
      ) VALUES ($1, $2, $3, $4, NOW())
      RETURNING created_at`,
      [payload.id, payload.objectType, claims.sub, payload.encryptedSessionKey]
    );

    const createdAt = result.rows[0]?.created_at;

    const response: VfsRegisterResponse = {
      id: payload.id,
      createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString()
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to register VFS item:', error);
    res.status(500).json({ error: 'Failed to register VFS item' });
  }
};

export function registerPostRegisterRoute(routeRouter: RouterType): void {
  routeRouter.post('/register', postRegisterHandler);
}
