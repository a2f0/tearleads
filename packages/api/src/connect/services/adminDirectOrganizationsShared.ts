import { create } from '@bufbuild/protobuf';
import type { AdminOrganization } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { AdminOrganizationSchema } from '@tearleads/shared/gen/tearleads/v2/admin_pb';

export type OrganizationRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

export function mapOrganizationRow(row: OrganizationRow): AdminOrganization {
  return create(AdminOrganizationSchema, {
    id: row.id,
    name: row.name,
    ...(typeof row.description === 'string'
      ? { description: row.description }
      : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  });
}
