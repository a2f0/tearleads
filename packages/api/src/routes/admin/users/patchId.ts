import type { AdminUserUpdateResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import {
  deleteAllSessionsForUser,
  getLatestLastActiveByUserIds
} from '../../../lib/sessions.js';
import { requireRootAdmin } from '../../../middleware/adminAccess.js';
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
 *               disabled:
 *                 type: boolean
 *               markedForDeletion:
 *                 type: boolean
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
const patchIdHandler = async (req: Request, res: Response) => {
  if (!requireRootAdmin(req, res)) {
    return;
  }

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

  // Get admin user ID from session for tracking who performed the action
  const adminUserId = req.session?.userId;

  if (updates.disabled !== undefined) {
    setClauses.push(`"disabled" = $${index}`);
    values.push(updates.disabled);
    index += 1;

    if (updates.disabled) {
      // COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=account-disable-attribution
      // When disabling, set timestamp and actor
      setClauses.push(`"disabled_at" = NOW()`);
      if (adminUserId) {
        setClauses.push(`"disabled_by" = $${index}`);
        values.push(adminUserId);
        index += 1;
      }
    } else {
      // When re-enabling, clear timestamp and actor
      setClauses.push(`"disabled_at" = NULL`);
      setClauses.push(`"disabled_by" = NULL`);
    }
  }

  if (updates.markedForDeletion !== undefined) {
    if (updates.markedForDeletion) {
      // COMPLIANCE_SENTINEL: TL-ACCT-003 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=deletion-marking-attribution
      // When marking for deletion, set timestamp and actor
      setClauses.push(`"marked_for_deletion_at" = NOW()`);
      if (adminUserId) {
        setClauses.push(`"marked_for_deletion_by" = $${index}`);
        values.push(adminUserId);
        index += 1;
      }
    } else {
      // When unmarking, clear timestamp and actor
      setClauses.push(`"marked_for_deletion_at" = NULL`);
      setClauses.push(`"marked_for_deletion_by" = NULL`);
    }
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
         RETURNING id, email, email_confirmed, admin, disabled, disabled_at, disabled_by, marked_for_deletion_at, marked_for_deletion_by`,
        [...values, userId]
      );
      updatedUser = result.rows[0];

      // If user was just disabled, delete all their sessions
      if (updates.disabled === true && updatedUser) {
        // COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=account-disable-attribution
        await deleteAllSessionsForUser(updatedUser.id);
      }
    } else {
      const result = await pool.query<UserRow>(
        'SELECT id, email, email_confirmed, admin, disabled, disabled_at, disabled_by, marked_for_deletion_at, marked_for_deletion_by FROM users WHERE id = $1',
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
      const personalOrgResult = await pool.query<{
        personal_organization_id: string | null;
      }>('SELECT personal_organization_id FROM users WHERE id = $1', [userId]);
      const personalOrganizationId =
        personalOrgResult.rows[0]?.personal_organization_id ?? null;

      if (!personalOrganizationId) {
        await pool.query('ROLLBACK');
        res.status(500).json({
          error: 'User personal organization is missing'
        });
        return;
      }

      const organizationIds = Array.from(
        new Set([...updates.organizationIds, personalOrganizationId])
      );
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
          `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
           SELECT $1, organization_id, NOW(), organization_id = $3
           FROM unnest($2::text[]) AS organization_id`,
          [userId, organizationIds, personalOrganizationId]
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
