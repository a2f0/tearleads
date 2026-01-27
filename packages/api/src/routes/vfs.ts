/**
 * VFS (Virtual Filesystem) API routes.
 *
 * Handles user key management and VFS item registration.
 */

import type {
  VfsKeySetupRequest,
  VfsObjectType,
  VfsRegisterRequest,
  VfsRegisterResponse,
  VfsUserKeysResponse
} from '@rapid/shared';
import { isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../lib/postgres.js';

const router: RouterType = Router();

// Valid VFS object types
const VALID_OBJECT_TYPES: VfsObjectType[] = [
  'file',
  'folder',
  'contact',
  'note',
  'photo'
];

/**
 * Type guard to validate VFS object types at runtime.
 * Used when parsing request payloads to ensure type safety.
 */
function isValidObjectType(value: unknown): value is VfsObjectType {
  return (
    typeof value === 'string' &&
    VALID_OBJECT_TYPES.includes(value as VfsObjectType)
  );
}

function parseKeySetupPayload(body: unknown): VfsKeySetupRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const publicEncryptionKey = body['publicEncryptionKey'];
  const publicSigningKey = body['publicSigningKey'];
  const encryptedPrivateKeys = body['encryptedPrivateKeys'];
  const argon2Salt = body['argon2Salt'];

  if (
    typeof publicEncryptionKey !== 'string' ||
    typeof publicSigningKey !== 'string' ||
    typeof encryptedPrivateKeys !== 'string' ||
    typeof argon2Salt !== 'string'
  ) {
    return null;
  }

  if (
    !publicEncryptionKey.trim() ||
    !publicSigningKey.trim() ||
    !encryptedPrivateKeys.trim() ||
    !argon2Salt.trim()
  ) {
    return null;
  }

  return {
    publicEncryptionKey: publicEncryptionKey.trim(),
    publicSigningKey: publicSigningKey.trim(),
    encryptedPrivateKeys: encryptedPrivateKeys.trim(),
    argon2Salt: argon2Salt.trim()
  };
}

function parseRegisterPayload(body: unknown): VfsRegisterRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const id = body['id'];
  const objectType = body['objectType'];
  const encryptedSessionKey = body['encryptedSessionKey'];

  if (
    typeof id !== 'string' ||
    !isValidObjectType(objectType) ||
    typeof encryptedSessionKey !== 'string'
  ) {
    return null;
  }

  if (!id.trim() || !encryptedSessionKey.trim()) {
    return null;
  }

  return {
    id: id.trim(),
    objectType,
    encryptedSessionKey: encryptedSessionKey.trim()
  };
}

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
router.get('/keys/me', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      public_encryption_key: string;
      public_signing_key: string;
    }>(
      `SELECT public_encryption_key, public_signing_key
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
      publicSigningKey: row.public_signing_key
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get VFS keys:', error);
    res.status(500).json({ error: 'Failed to get VFS keys' });
  }
});

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
router.post('/keys', async (req: Request, res: Response) => {
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

    // Check if keys already exist
    const existing = await pool.query(
      'SELECT 1 FROM user_keys WHERE user_id = $1',
      [claims.sub]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'VFS keys already exist for this user' });
      return;
    }

    // Insert new keys
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
});

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
 *                 enum: [file, folder, contact, note, photo]
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
router.post('/register', async (req: Request, res: Response) => {
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

    // Check if already registered
    const existing = await pool.query(
      'SELECT 1 FROM vfs_registry WHERE id = $1',
      [payload.id]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Item already registered in VFS' });
      return;
    }

    // Insert into vfs_registry
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
});

export { router as vfsRouter };
