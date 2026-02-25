import type { MlsKeyPackage, MlsKeyPackagesResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';
import { toSafeCipherSuite } from './shared.js';

/**
 * @openapi
 * /mls/key-packages/{userId}:
 *   get:
 *     summary: Get available key packages for a user
 *     description: Get unconsumed key packages for a user (to add them to a group)
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
 *         description: Available key packages
 */
const getKeyPackagesUseridHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userIdParam = req.params['userId'];
  if (!userIdParam || typeof userIdParam !== 'string') {
    res.status(400).json({ error: 'userId is required' });
    return;
  }
  const userId = userIdParam;

  try {
    const pool = await getPool('read');

    const sharedOrganizationResult = await pool.query(
      `SELECT 1
         FROM user_organizations requestor_uo
         INNER JOIN user_organizations target_uo
           ON target_uo.organization_id = requestor_uo.organization_id
        WHERE requestor_uo.user_id = $1
          AND target_uo.user_id = $2
        LIMIT 1`,
      [claims.sub, userId]
    );

    if (sharedOrganizationResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const result = await pool.query<{
      id: string;
      key_package_data: string;
      key_package_ref: string;
      cipher_suite: number;
      created_at: Date;
    }>(
      `SELECT id, key_package_data, key_package_ref, cipher_suite, created_at
       FROM mls_key_packages
       WHERE user_id = $1 AND consumed_at IS NULL
       ORDER BY created_at ASC
       LIMIT 10`,
      [userId]
    );

    const keyPackages: MlsKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId,
      keyPackageData: row.key_package_data,
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      consumed: false
    }));

    const response: MlsKeyPackagesResponse = { keyPackages };
    res.json(response);
  } catch (error) {
    console.error('Failed to get key packages:', error);
    res.status(500).json({ error: 'Failed to get key packages' });
  }
};

export function registerGetKeyPackagesUseridRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/key-packages/:userId', getKeyPackagesUseridHandler);
}
