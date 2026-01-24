import { randomUUID } from 'node:crypto';
import {
  isRecord,
  type KeyPackageCountResponse,
  type KeyPackageResponse,
  type KeyPackageUpload
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

const router: RouterType = Router();

function parseKeyPackagesUpload(body: unknown): KeyPackageUpload[] | null {
  if (!isRecord(body)) {
    return null;
  }
  const keyPackages = body['keyPackages'];
  if (!Array.isArray(keyPackages)) {
    return null;
  }
  const parsed: KeyPackageUpload[] = [];
  for (const pkg of keyPackages) {
    if (!isRecord(pkg)) {
      return null;
    }
    const keyPackageData = pkg['keyPackageData'];
    if (typeof keyPackageData !== 'string' || !keyPackageData.trim()) {
      return null;
    }
    parsed.push({ keyPackageData: keyPackageData.trim() });
  }
  return parsed.length > 0 ? parsed : null;
}

/**
 * @openapi
 * /mls/key-packages:
 *   post:
 *     summary: Upload KeyPackages
 *     description: Upload one or more KeyPackages for the authenticated user.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keyPackages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     keyPackageData:
 *                       type: string
 *                       description: Base64-encoded KeyPackage
 *     responses:
 *       201:
 *         description: KeyPackages uploaded
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 */
router.post('/', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const keyPackages = parseKeyPackagesUpload(req.body);
  if (!keyPackages) {
    res.status(400).json({ error: 'keyPackages array is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const now = new Date();

    for (const pkg of keyPackages) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO mls_key_packages (id, user_id, key_package_data, created_at, consumed)
         VALUES ($1, $2, $3, $4, FALSE)`,
        [id, claims.sub, pkg.keyPackageData, now]
      );
    }

    res.status(201).json({ uploaded: keyPackages.length });
  } catch (error) {
    console.error('Failed to upload KeyPackages:', error);
    res.status(500).json({ error: 'Failed to upload KeyPackages' });
  }
});

/**
 * @openapi
 * /mls/key-packages/count:
 *   get:
 *     summary: Get available KeyPackage count
 *     description: Returns the count of unconsumed KeyPackages for the authenticated user.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KeyPackage count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/count', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM mls_key_packages
       WHERE user_id = $1 AND consumed = FALSE`,
      [claims.sub]
    );

    const count = parseInt(result.rows[0]?.count ?? '0', 10);
    const response: KeyPackageCountResponse = { count };
    res.json(response);
  } catch (error) {
    console.error('Failed to get KeyPackage count:', error);
    res.status(500).json({ error: 'Failed to get KeyPackage count' });
  }
});

/**
 * @openapi
 * /mls/key-packages/{userId}:
 *   get:
 *     summary: Fetch and consume a KeyPackage
 *     description: Returns an unconsumed KeyPackage for a user and marks it as consumed.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: KeyPackage
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 keyPackageData:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No available KeyPackages
 */
router.get('/:userId', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { userId } = req.params;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Atomically select and consume a KeyPackage
    const result = await pool.query<{ id: string; key_package_data: string }>(
      `UPDATE mls_key_packages
       SET consumed = TRUE
       WHERE id = (
         SELECT id FROM mls_key_packages
         WHERE user_id = $1 AND consumed = FALSE
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, key_package_data`,
      [userId]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'No available KeyPackages for this user' });
      return;
    }

    const response: KeyPackageResponse = {
      id: row.id,
      keyPackageData: row.key_package_data
    };
    res.json(response);
  } catch (error) {
    console.error('Failed to fetch KeyPackage:', error);
    res.status(500).json({ error: 'Failed to fetch KeyPackage' });
  }
});

export { router as keyPackagesRouter };
