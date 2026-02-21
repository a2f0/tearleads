import { randomUUID } from 'node:crypto';
import type {
  MlsKeyPackage,
  UploadMlsKeyPackagesResponse
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseUploadKeyPackagesPayload } from './shared.js';

/**
 * @openapi
 * /mls/key-packages:
 *   post:
 *     summary: Upload MLS key packages
 *     description: Upload one or more key packages for the current user. Others can use these to add the user to groups.
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
 *                     keyPackageRef:
 *                       type: string
 *                     cipherSuite:
 *                       type: integer
 *     responses:
 *       201:
 *         description: Key packages uploaded successfully
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 */
const postKeyPackagesHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseUploadKeyPackagesPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid key packages payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const uploadedPackages: MlsKeyPackage[] = [];

    for (const kp of payload.keyPackages) {
      const id = randomUUID();
      const result = await pool.query<{ created_at: Date }>(
        `INSERT INTO mls_key_packages (
          id, user_id, key_package_data, key_package_ref, cipher_suite, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (key_package_ref) DO NOTHING
        RETURNING created_at`,
        [id, claims.sub, kp.keyPackageData, kp.keyPackageRef, kp.cipherSuite]
      );

      if (result.rows[0]) {
        uploadedPackages.push({
          id,
          userId: claims.sub,
          keyPackageData: kp.keyPackageData,
          keyPackageRef: kp.keyPackageRef,
          cipherSuite: kp.cipherSuite,
          createdAt: result.rows[0].created_at.toISOString(),
          consumed: false
        });
      }
    }

    const response: UploadMlsKeyPackagesResponse = {
      keyPackages: uploadedPackages
    };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to upload key packages:', error);
    res.status(500).json({ error: 'Failed to upload key packages' });
  }
};

export function registerPostKeyPackagesRoute(routeRouter: RouterType): void {
  routeRouter.post('/key-packages', postKeyPackagesHandler);
}
