import { randomUUID } from 'node:crypto';
import type { CreateOrganizationRequest } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { buildRevenueCatAppUserId } from '../../../lib/billing.js';
import { getPostgresPool } from '../../../lib/postgres.js';
import { requireRootAdmin } from '../../../middleware/adminAccess.js';
import { isDuplicateConstraintError } from '../lib/db.js';
import { mapOrganizationRow, type OrganizationRow } from './shared.js';

/**
 * @openapi
 * /admin/organizations:
 *   post:
 *     summary: Create a new organization
 *     description: Creates an organization with the given name and optional description.
 *     tags:
 *       - Admin
 *     responses:
 *       201:
 *         description: Organization created successfully
 *       400:
 *         description: Invalid request body
 *       409:
 *         description: Organization name already exists
 *       500:
 *         description: Database error
 */
const postRootHandler = async (
  req: Request<Record<string, never>, unknown, CreateOrganizationRequest>,
  res: Response
) => {
  if (!requireRootAdmin(req, res)) {
    return;
  }

  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const pool = await getPostgresPool();
    const id = randomUUID();
    const now = new Date();
    const revenueCatAppUserId = buildRevenueCatAppUserId(id);

    const result = await pool.query<OrganizationRow>(
      `WITH inserted_org AS (
         INSERT INTO organizations (id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         RETURNING id, name, description, created_at, updated_at
       ),
       inserted_billing AS (
         INSERT INTO organization_billing_accounts (
           organization_id,
           revenuecat_app_user_id,
           entitlement_status,
           created_at,
           updated_at
         )
         SELECT id, $5, 'inactive', $4, $4
         FROM inserted_org
       )
       SELECT id, name, description, created_at, updated_at
       FROM inserted_org`,
      [id, name.trim(), description?.trim() || null, now, revenueCatAppUserId]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Failed to create organization' });
      return;
    }

    const organization = mapOrganizationRow(row);

    res.status(201).json({ organization });
  } catch (err) {
    console.error('Organizations error:', err);
    if (isDuplicateConstraintError(err)) {
      res.status(409).json({ error: 'Organization name already exists' });
      return;
    }
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to create organization'
    });
  }
};

export function registerPostRootRoute(routeRouter: RouterType): void {
  routeRouter.post('/', postRootHandler);
}
