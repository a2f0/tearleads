import type { AdminUsersResponse } from '@rapid/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { getLatestLastActiveByUserIds } from '../../../lib/sessions.js';
import {
  emptyAccounting,
  getUserAccounting,
  mapUserRow,
  type UserRow
} from './shared.js';

/**
 * @openapi
 * /admin/users:
 *   get:
 *     summary: List users
 *     description: Returns all users for admin management.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Postgres connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const getRootHandler = async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<UserRow>(
      `SELECT
         u.id,
         u.email,
         u.email_confirmed,
         u.admin,
         MIN(uc.created_at) AS created_at,
         COALESCE(
           ARRAY_AGG(uo.organization_id) FILTER (WHERE uo.organization_id IS NOT NULL),
           '{}'
         ) AS organization_ids
       FROM users u
       LEFT JOIN user_organizations uo ON uo.user_id = u.id
       LEFT JOIN user_credentials uc ON uc.user_id = u.id
       GROUP BY u.id
       ORDER BY u.email`
    );
    const userIds = result.rows.map((row) => row.id);
    const lastActiveByUserId = await getLatestLastActiveByUserIds(userIds);
    const accountingByUserId = await getUserAccounting(pool, userIds);
    const users = result.rows.map((row) =>
      mapUserRow(row, {
        lastActiveAt: lastActiveByUserId[row.id] ?? null,
        accounting: accountingByUserId[row.id] ?? emptyAccounting
      })
    );
    const response: AdminUsersResponse = { users };
    res.json(response);
  } catch (err) {
    console.error('Users admin error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query users'
    });
  }
};

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}
