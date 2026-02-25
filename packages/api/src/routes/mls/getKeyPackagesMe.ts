import type { MlsKeyPackage, MlsKeyPackagesResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../lib/postgres.js';
import { toSafeCipherSuite } from './shared.js';

/**
 * @openapi
 * /mls/key-packages/me:
 *   get:
 *     summary: Get current user's key packages
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's key packages
 */
const getKeyPackagesMeHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      key_package_data: string;
      key_package_ref: string;
      cipher_suite: number;
      created_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT id, key_package_data, key_package_ref, cipher_suite, created_at, consumed_at
       FROM mls_key_packages
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [claims.sub]
    );

    const keyPackages: MlsKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: claims.sub,
      keyPackageData: row.key_package_data,
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      consumed: row.consumed_at !== null
    }));

    const response: MlsKeyPackagesResponse = { keyPackages };
    res.json(response);
  } catch (error) {
    console.error('Failed to get key packages:', error);
    res.status(500).json({ error: 'Failed to get key packages' });
  }
};

export function registerGetKeyPackagesMeRoute(routeRouter: RouterType): void {
  routeRouter.get('/key-packages/me', getKeyPackagesMeHandler);
}
