import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  CreateOrganizationRequest,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse,
  OrganizationUsersResponse,
  UpdateOrganizationRequest
} from '@tearleads/shared';
import { buildRevenueCatAppUserId } from '../../lib/billing.js';
import { getPool } from '../../lib/postgres.js';
import {
  requireScopedAdminAccess,
  type ScopedAdminAccess
} from './adminDirectAuth.js';
import {
  mapOrganizationRow,
  type OrganizationRow
} from './adminDirectOrganizationsShared.js';

type IdRequest = { id: string };
type JsonRequest = { json: string };
type IdJsonRequest = { id: string; json: string };
type ListOrganizationsRequest = { organizationId: string };

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function canAccessOrganization(
  authorization: ScopedAdminAccess,
  organizationId: string
): boolean {
  return (
    authorization.adminAccess.isRootAdmin ||
    authorization.adminAccess.organizationIds.includes(organizationId)
  );
}

function normalizeOptionalOrganizationId(
  organizationId: string
): string | null {
  const trimmed = organizationId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureRootAdmin(authorization: ScopedAdminAccess): void {
  if (!authorization.adminAccess.isRootAdmin) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonBody(json: string): unknown {
  const normalized = json.trim().length > 0 ? json : '{}';
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }
}

function isDuplicateConstraintError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const code = error['code'];
  return typeof code === 'string' && code === '23505';
}

async function ensureOrganizationExists(organizationId: string): Promise<void> {
  const pool = await getPool('read');
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM organizations WHERE id = $1',
    [organizationId]
  );
  if (result.rows.length === 0) {
    throw new ConnectError('Organization not found', Code.NotFound);
  }
}

export async function listOrganizationsDirect(
  request: ListOrganizationsRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    '/admin/organizations',
    context.requestHeader
  );
  const requestedOrganizationId = normalizeOptionalOrganizationId(
    request.organizationId
  );
  if (
    requestedOrganizationId !== null &&
    !canAccessOrganization(authorization, requestedOrganizationId)
  ) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  try {
    const pool = await getPool('read');
    const result =
      authorization.adminAccess.isRootAdmin && requestedOrganizationId === null
        ? await pool.query<OrganizationRow>(
            `SELECT id, name, description, created_at, updated_at
               FROM organizations
               ORDER BY name`
          )
        : await pool.query<OrganizationRow>(
            `SELECT id, name, description, created_at, updated_at
               FROM organizations
               WHERE id = ANY($1::text[])
               ORDER BY name`,
            [
              requestedOrganizationId !== null
                ? [requestedOrganizationId]
                : authorization.adminAccess.organizationIds
            ]
          );

    const response: OrganizationsListResponse = {
      organizations: result.rows.map(mapOrganizationRow)
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Organizations error:', error);
    throw new ConnectError('Failed to fetch organizations', Code.Internal);
  }
}

export async function getOrganizationDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/organizations/${encoded(request.id)}`,
    context.requestHeader
  );
  if (!canAccessOrganization(authorization, request.id)) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  try {
    const pool = await getPool('read');
    const result = await pool.query<OrganizationRow>(
      `SELECT id, name, description, created_at, updated_at
         FROM organizations
         WHERE id = $1`,
      [request.id]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Organization not found', Code.NotFound);
    }

    const response: OrganizationResponse = {
      organization: mapOrganizationRow(row)
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Organizations error:', error);
    throw new ConnectError('Failed to fetch organization', Code.Internal);
  }
}

export async function createOrganizationDirect(
  request: JsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    '/admin/organizations',
    context.requestHeader
  );
  ensureRootAdmin(authorization);

  const parsed = parseJsonBody(request.json);
  const payload: Partial<CreateOrganizationRequest> = isRecord(parsed)
    ? parsed
    : {};
  const { name, description } = payload;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ConnectError('Name is required', Code.InvalidArgument);
  }

  try {
    const pool = await getPool('write');
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
      [
        id,
        name.trim(),
        typeof description === 'string' ? description.trim() || null : null,
        now,
        revenueCatAppUserId
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Failed to create organization', Code.Internal);
    }

    const response: OrganizationResponse = {
      organization: mapOrganizationRow(row)
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Organizations error:', error);
    if (isDuplicateConstraintError(error)) {
      throw new ConnectError(
        'Organization name already exists',
        Code.AlreadyExists
      );
    }
    throw new ConnectError('Failed to create organization', Code.Internal);
  }
}

export async function updateOrganizationDirect(
  request: IdJsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/organizations/${encoded(request.id)}`,
    context.requestHeader
  );
  ensureRootAdmin(authorization);

  const parsed = parseJsonBody(request.json);
  const payload: Partial<UpdateOrganizationRequest> = isRecord(parsed)
    ? parsed
    : {};
  const { name, description } = payload;

  try {
    const pool = await getPool('write');
    const updates: string[] = [];
    const values: (string | Date | null)[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new ConnectError('Name cannot be empty', Code.InvalidArgument);
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(
        typeof description === 'string' ? description.trim() || null : null
      );
    }

    if (updates.length === 0) {
      throw new ConnectError('No fields to update', Code.InvalidArgument);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());
    values.push(request.id);

    const result = await pool.query<OrganizationRow>(
      `UPDATE organizations
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, name, description, created_at, updated_at`,
      values
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Organization not found', Code.NotFound);
    }

    const response: OrganizationResponse = {
      organization: mapOrganizationRow(row)
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Organizations error:', error);
    if (isDuplicateConstraintError(error)) {
      throw new ConnectError(
        'Organization name already exists',
        Code.AlreadyExists
      );
    }
    throw new ConnectError('Failed to update organization', Code.Internal);
  }
}

export async function deleteOrganizationDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/organizations/${encoded(request.id)}`,
    context.requestHeader
  );
  ensureRootAdmin(authorization);

  try {
    const pool = await getPool('write');
    const existing = await pool.query<{ is_personal: boolean }>(
      'SELECT is_personal FROM organizations WHERE id = $1',
      [request.id]
    );

    const organization = existing.rows[0];
    if (!organization) {
      return { json: JSON.stringify({ deleted: false }) };
    }

    if (organization.is_personal) {
      throw new ConnectError(
        'Personal organizations cannot be deleted',
        Code.InvalidArgument
      );
    }

    const result = await pool.query('DELETE FROM organizations WHERE id = $1', [
      request.id
    ]);
    return {
      json: JSON.stringify({
        deleted: result.rowCount !== null && result.rowCount > 0
      })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Organizations error:', error);
    throw new ConnectError('Failed to delete organization', Code.Internal);
  }
}

export async function getOrganizationUsersDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/organizations/${encoded(request.id)}/users`,
    context.requestHeader
  );
  if (!canAccessOrganization(authorization, request.id)) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  try {
    await ensureOrganizationExists(request.id);
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      email: string;
      joined_at: Date;
    }>(
      `SELECT u.id, u.email, uo.joined_at
         FROM users u
         INNER JOIN user_organizations uo ON uo.user_id = u.id
         WHERE uo.organization_id = $1
         ORDER BY u.email`,
      [request.id]
    );

    const response: OrganizationUsersResponse = {
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        joinedAt: row.joined_at.toISOString()
      }))
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Organizations error:', error);
    throw new ConnectError('Failed to fetch organization users', Code.Internal);
  }
}

export async function getOrganizationGroupsDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/organizations/${encoded(request.id)}/groups`,
    context.requestHeader
  );
  if (!canAccessOrganization(authorization, request.id)) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  try {
    await ensureOrganizationExists(request.id);
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      member_count: number;
    }>(
      `SELECT g.id, g.name, g.description, COUNT(ug.user_id)::integer AS member_count
         FROM groups g
         LEFT JOIN user_groups ug ON ug.group_id = g.id
         WHERE g.organization_id = $1
         GROUP BY g.id
         ORDER BY g.name`,
      [request.id]
    );

    const response: OrganizationGroupsResponse = {
      groups: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        memberCount: row.member_count
      }))
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Organizations error:', error);
    throw new ConnectError(
      'Failed to fetch organization groups',
      Code.Internal
    );
  }
}
