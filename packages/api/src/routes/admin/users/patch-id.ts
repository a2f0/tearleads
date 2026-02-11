import type { AdminUserUpdateResponse } from '@rapid/shared';
import { type Request, type Response, type Router as RouterType } from 'express';
import { getLatestLastActiveByUserIds } from '../../../lib/sessions.js';
import { getPostgresPool } from '../../../lib/postgres.js';
import {
  emptyAccounting,
  getUserAccounting,
  mapUserRow,
  parseUserUpdatePayload,
  type UserRow
} from './shared.js';

/**
 * @openapi
 * /admin/users/{id}:
 *   patch:
 *     summary: Update a user
 *     description: Updates user attributes for admin management.
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               emailConfirmed:
 *                 type: boolean
 *               admin:
 *                 type: boolean
 *               organizationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *       400:
 *         description: Invalid payload
 *       404:
 *         description: User not found
 *       500:
 *         description: Postgres connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const patchIdHandler = async (req: Request, res: Response) => {
  const updates = parseUserUpdatePayload(req.body);
  if (!updates) {
    res.status(400).json({ error: 'Invalid user update payload' });
    return;
  }

  const setClauses: string[] = [];
  const values: Array<string | boolean> = [];
  let index = 1;

  if (updates.email !== undefined) {
    setClauses.push(`"email" = $${index}`);
    values.push(updates.email);
    index += 1;
  }

  if (updates.emailConfirmed !== undefined) {
    setClauses.push(`"email_confirmed" = $${index}`);
    values.push(updates.emailConfirmed);
    index += 1;
  }

  if (updates.admin !== undefined) {
    setClauses.push(`"admin" = $${index}`);
    values.push(updates.admin);
    index += 1;
  }

  let pool: Awaited<ReturnType<typeof getPostgresPool>> | null = null;
  try {
    pool = await getPostgresPool();
    const userId = req.params['id'];
    await pool.query('BEGIN');

    let updatedUser: UserRow | undefined;

    if (setClauses.length > 0) {
      const result = await pool.query<UserRow>(
        `UPDATE users
         SET ${setClauses.join(', ')}
         WHERE id = $${index}
         RETURNING id, email, email_confirmed, admin`,
        [...values, userId]
      );
      updatedUser = result.rows[0];
    } else {
      const result = await pool.query<UserRow>(
        'SELECT id, email, email_confirmed, admin FROM users WHERE id = $1',
        [userId]
      );
      updatedUser = result.rows[0];
    }

    if (!updatedUser) {
      await pool.query('ROLLBACK');
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (updates.organizationIds !== undefined) {
      const organizationIds = updates.organizationIds;
      if (organizationIds.length > 0) {
        const orgResult = await pool.query<{ id: string }>(
          'SELECT id FROM organizations WHERE id = ANY($1::text[])',
          [organizationIds]
        );
        if (orgResult.rows.length !== organizationIds.length) {
          await pool.query('ROLLBACK');
          res.status(404).json({ error: 'Organization not found' });
          return;
        }
      }

      await pool.query('DELETE FROM user_organizations WHERE user_id = $1', [
        userId
      ]);

      if (organizationIds.length > 0) {
        await pool.query(
          `INSERT INTO user_organizations (user_id, organization_id, joined_at)
           SELECT $1, unnest($2::text[]), NOW()`,
          [userId, organizationIds]
        );
      }
    }

    const orgResult = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM user_organizations WHERE user_id = $1 ORDER BY organization_id',
      [updatedUser.id]
    );

    const createdAtResult = await pool.query<{ created_at: Date | null }>(
      'SELECT MIN(created_at) AS created_at FROM user_credentials WHERE user_id = $1',
      [updatedUser.id]
    );
    const createdAt = createdAtResult.rows[0]?.created_at ?? null;

    await pool.query('COMMIT');

    const lastActiveAt =
      (await getLatestLastActiveByUserIds([updatedUser.id]))[updatedUser.id] ??
      null;
    const accountingByUserId = await getUserAccounting(pool, [updatedUser.id]);
    const response: AdminUserUpdateResponse = {
      user: mapUserRow(
        {
          ...updatedUser,
          organization_ids: orgResult.rows.map((row) => row.organization_id),
          created_at: createdAt
        },
        {
          lastActiveAt,
          accounting: accountingByUserId[updatedUser.id] ?? emptyAccounting
        }
      )
    };
    res.json(response);
  } catch (err) {
    console.error('Users admin error:', err);
    if (pool) {
      try {
        await pool.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback user update:', rollbackError);
      }
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to update user'
    });
  }
};

export function registerPatchIdRoute(routeRouter: RouterType): void {
  routeRouter.patch('/:id', patchIdHandler);
}
