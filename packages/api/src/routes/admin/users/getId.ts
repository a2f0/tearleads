import type { AdminUserResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { getLatestLastActiveByUserIds } from '../../../lib/sessions.js';
import {
  ensureOrganizationAccess,
  parseOrganizationIdQuery
} from '../../../middleware/adminAccess.js';
import {
  emptyAccounting,
  getUserAccounting,
  mapUserRow,
  type UserRow
} from './shared.js';

/**
 * @openapi
 * /admin/users/{id}:
 *   get:
 *     summary: Get a user by ID
 *     description: Returns a single user for admin management.
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *       404:
 *         description: User not found
 *       500:
 *         description: Postgres connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
const getIdHandler = async (req: Request, res: Response) => {
  try {
    const access = req.adminAccess;
    if (!access) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const requestedOrganizationId = parseOrganizationIdQuery(req, res);
    if (requestedOrganizationId === undefined) {
      return;
    }
    if (
      requestedOrganizationId &&
      !ensureOrganizationAccess(req, res, requestedOrganizationId)
    ) {
      return;
    }

    const pool = await getPostgresPool();
    const result =
      access.isRootAdmin && !requestedOrganizationId
        ? await pool.query<UserRow>(
            `SELECT
               u.id,
               u.email,
               u.email_confirmed,
               u.admin,
               u.disabled,
               u.disabled_at,
               u.disabled_by,
               u.marked_for_deletion_at,
               u.marked_for_deletion_by,
               MIN(uc.created_at) AS created_at,
               COALESCE(
                 ARRAY_AGG(uo.organization_id) FILTER (WHERE uo.organization_id IS NOT NULL),
                 '{}'
               ) AS organization_ids
             FROM users u
             LEFT JOIN user_organizations uo ON uo.user_id = u.id
             LEFT JOIN user_credentials uc ON uc.user_id = u.id
             WHERE u.id = $1
             GROUP BY u.id`,
            [req.params['id']]
          )
        : await pool.query<UserRow>(
            `SELECT
               u.id,
               u.email,
               u.email_confirmed,
               u.admin,
               u.disabled,
               u.disabled_at,
               u.disabled_by,
               u.marked_for_deletion_at,
               u.marked_for_deletion_by,
               MIN(uc.created_at) AS created_at,
               COALESCE(
                 ARRAY_AGG(uo.organization_id) FILTER (
                   WHERE uo.organization_id = ANY($2::text[])
                 ),
                 '{}'
               ) AS organization_ids
             FROM users u
             LEFT JOIN user_organizations uo ON uo.user_id = u.id
             LEFT JOIN user_credentials uc ON uc.user_id = u.id
             WHERE u.id = $1
               AND EXISTS (
                 SELECT 1
                 FROM user_organizations uof
                 WHERE uof.user_id = u.id
                   AND uof.organization_id = ANY($2::text[])
               )
             GROUP BY u.id`,
            [
              req.params['id'],
              requestedOrganizationId
                ? [requestedOrganizationId]
                : access.organizationIds
            ]
          );

    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const lastActiveAt =
      (await getLatestLastActiveByUserIds([user.id]))[user.id] ?? null;
    const accountingByUserId = await getUserAccounting(pool, [user.id]);
    const response: AdminUserResponse = {
      user: mapUserRow(user, {
        lastActiveAt,
        accounting: accountingByUserId[user.id] ?? emptyAccounting
      })
    };
    res.json(response);
  } catch (err) {
    console.error('Users admin error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query user'
    });
  }
};

export function registerGetIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id', getIdHandler);
}
