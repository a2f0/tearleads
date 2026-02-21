import type { Response } from 'express';
import type { Pool } from 'pg';

type OrganizationIdRow = { id: string };

async function organizationExists(
  pool: Pool,
  organizationId: string
): Promise<boolean> {
  const result = await pool.query<OrganizationIdRow>(
    'SELECT id FROM organizations WHERE id = $1',
    [organizationId]
  );
  return result.rows.length > 0;
}

export async function ensureOrganizationExists(
  pool: Pool,
  organizationId: string,
  res: Response
): Promise<boolean> {
  const exists = await organizationExists(pool, organizationId);
  if (!exists) {
    res.status(404).json({ error: 'Organization not found' });
  }
  return exists;
}
