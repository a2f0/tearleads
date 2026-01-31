import type {
  AdminUser,
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload,
  AdminUserUpdateResponse
} from '@rapid/shared';
import { isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { getLatestLastActiveByUserIds } from '../../lib/sessions.js';

type UserRow = {
  id: string;
  email: string;
  email_confirmed: boolean;
  admin: boolean;
  organization_ids: string[] | null;
  created_at?: Date | string | null;
};

const usersRouter: RouterType = Router();

type AdminUserOverrides = {
  createdAt?: string | null;
  lastActiveAt?: string | null;
};

function normalizeDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function mapUserRow(
  row: UserRow,
  overrides: AdminUserOverrides = {}
): AdminUser {
  return {
    id: row.id,
    email: row.email,
    emailConfirmed: row.email_confirmed,
    admin: row.admin,
    organizationIds: Array.isArray(row.organization_ids)
      ? row.organization_ids
      : [],
    createdAt: overrides.createdAt ?? normalizeDate(row.created_at),
    lastActiveAt: overrides.lastActiveAt ?? null
  };
}

function parseUserUpdatePayload(body: unknown): AdminUserUpdatePayload | null {
  if (!isRecord(body)) {
    return null;
  }

  const updates: AdminUserUpdatePayload = {};

  if ('email' in body) {
    const emailValue = body['email'];
    if (typeof emailValue !== 'string') {
      return null;
    }
    const trimmedEmail = emailValue.trim().toLowerCase();
    if (!trimmedEmail) {
      return null;
    }
    updates.email = trimmedEmail;
  }

  if ('emailConfirmed' in body) {
    const emailConfirmedValue = body['emailConfirmed'];
    if (typeof emailConfirmedValue !== 'boolean') {
      return null;
    }
    updates.emailConfirmed = emailConfirmedValue;
  }

  if ('admin' in body) {
    const adminValue = body['admin'];
    if (typeof adminValue !== 'boolean') {
      return null;
    }
    updates.admin = adminValue;
  }

  if ('organizationIds' in body) {
    const orgsValue = body['organizationIds'];
    if (!Array.isArray(orgsValue)) {
      return null;
    }

    const trimmed: string[] = [];
    for (const entry of orgsValue) {
      if (typeof entry !== 'string') {
        return null;
      }
      const cleaned = entry.trim();
      if (cleaned) {
        trimmed.push(cleaned);
      }
    }

    updates.organizationIds = Array.from(new Set(trimmed));
  }

  if (Object.keys(updates).length === 0) {
    return null;
  }

  return updates;
}

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
usersRouter.get('/', async (_req: Request, res: Response) => {
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
    const lastActiveByUserId = await getLatestLastActiveByUserIds(
      result.rows.map((row) => row.id)
    );
    const users = result.rows.map((row) =>
      mapUserRow(row, { lastActiveAt: lastActiveByUserId[row.id] ?? null })
    );
    const response: AdminUsersResponse = { users };
    res.json(response);
  } catch (err) {
    console.error('Users admin error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query users'
    });
  }
});

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
usersRouter.get('/:id', async (req: Request, res: Response) => {
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
       WHERE u.id = $1
       GROUP BY u.id`,
      [req.params['id']]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const lastActiveAt =
      (await getLatestLastActiveByUserIds([user.id]))[user.id] ?? null;
    const response: AdminUserResponse = {
      user: mapUserRow(user, { lastActiveAt })
    };
    res.json(response);
  } catch (err) {
    console.error('Users admin error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query user'
    });
  }
});

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
usersRouter.patch('/:id', async (req: Request, res: Response) => {
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
          `INSERT INTO user_organizations (user_id, organization_id)
           SELECT $1, unnest($2::text[])`,
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
    const response: AdminUserUpdateResponse = {
      user: mapUserRow(
        {
          ...updatedUser,
          organization_ids: orgResult.rows.map((row) => row.organization_id),
          created_at: createdAt
        },
        { lastActiveAt }
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
});

export { usersRouter };
