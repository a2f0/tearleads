import { randomUUID } from 'node:crypto';
import type { CreateMlsGroupResponse, MlsGroup } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { parseCreateGroupPayload } from './shared.js';

/**
 * @openapi
 * /mls/groups:
 *   post:
 *     summary: Create a new MLS group
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Group created
 */
const postGroupsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseCreateGroupPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid group payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const id = randomUUID();
    const now = new Date();
    const organizationResult = await pool.query<{
      personal_organization_id: string;
    }>(
      `SELECT personal_organization_id
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [claims.sub]
    );
    const organizationId = organizationResult.rows[0]?.personal_organization_id;
    if (!organizationId) {
      res.status(403).json({ error: 'No organization found for user' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create group
      await client.query(
        `INSERT INTO mls_groups (
          id, organization_id, group_id_mls, name, description, creator_user_id,
          current_epoch, cipher_suite, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $8)`,
        [
          id,
          organizationId,
          payload.groupIdMls,
          payload.name,
          payload.description ?? null,
          claims.sub,
          payload.cipherSuite,
          now
        ]
      );

      // Add creator as admin member
      await client.query(
        `INSERT INTO mls_group_members (
          group_id, user_id, leaf_index, role, joined_at, joined_at_epoch
        ) VALUES ($1, $2, 0, 'admin', $3, 0)`,
        [id, claims.sub, now]
      );

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }

    const group: MlsGroup = {
      id,
      groupIdMls: payload.groupIdMls,
      name: payload.name,
      description: payload.description ?? null,
      creatorUserId: claims.sub,
      currentEpoch: 0,
      cipherSuite: payload.cipherSuite,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      memberCount: 1,
      role: 'admin'
    };

    const response: CreateMlsGroupResponse = { group };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to create group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
};

export function registerPostGroupsRoute(routeRouter: RouterType): void {
  routeRouter.post('/groups', postGroupsHandler);
}
