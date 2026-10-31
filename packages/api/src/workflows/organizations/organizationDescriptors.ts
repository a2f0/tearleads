import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { groups, organizations } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  memoizedGroupOrganizationDescriptor,
  memoizedOrganizationDescriptor,
  type OrganizationDescriptor,
  rememberOrganizationDescriptor,
} from "../../access/read/principalStateStore";

const descriptorSelect = {
  adminGroupId: organizations.adminGroupId,
  memberGroupId: organizations.memberGroupId,
  organizationId: organizations.id,
};

/**
 * The organization's reserved group ids. Under the organization's principal
 * lock the first read serves the rest of the transaction.
 */
export async function loadOrganizationDescriptor(
  tx: DatabaseSession,
  organizationId: string,
): Promise<OrganizationDescriptor | null> {
  const memoized = memoizedOrganizationDescriptor(tx, organizationId);
  if (memoized) return memoized;
  const [row] = await tx
    .select(descriptorSelect)
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!row) return null;
  rememberOrganizationDescriptor(tx, row);
  return row;
}

/** The organization owning `groupId`, kept like `loadOrganizationDescriptor`. */
export async function loadGroupOrganizationDescriptor(
  tx: DatabaseSession,
  groupId: string,
): Promise<OrganizationDescriptor | null> {
  const memoized = memoizedGroupOrganizationDescriptor(tx, groupId);
  if (memoized) return memoized;
  const [row] = await tx
    .select(descriptorSelect)
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!row) return null;
  rememberOrganizationDescriptor(tx, row, groupId);
  return row;
}
