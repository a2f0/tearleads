import type {
  AdminUser,
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

type UserRow = {
  id: string;
  email: string;
  email_confirmed: boolean;
  admin: boolean;
};

const router: RouterType = Router();

function mapUserRow(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    emailConfirmed: row.email_confirmed,
    admin: row.admin
  };
}

function parseUserUpdatePayload(
  body: unknown
): AdminUserUpdatePayload | null {
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
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<UserRow>(
      `SELECT id, email, email_confirmed, admin
       FROM users
       ORDER BY email`
    );
    const response: AdminUsersResponse = {
      users: result.rows.map(mapUserRow)
    };
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
router.patch('/:id', async (req: Request, res: Response) => {
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

  if (setClauses.length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<UserRow>(
      `UPDATE users
       SET ${setClauses.join(', ')}
       WHERE id = $${index}
       RETURNING id, email, email_confirmed, admin`,
      [...values, req.params['id']]
    );

    const updatedUser = result.rows[0];
    if (!updatedUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const response: AdminUserUpdateResponse = {
      user: mapUserRow(updatedUser)
    };
    res.json(response);
  } catch (err) {
    console.error('Users admin error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to update user'
    });
  }
});

export { router as usersRouter };
