import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

/** Whether `groupId` is the organization's reserved Admins group. */
export async function isOrganizationAdminsGroup(
  tx: DatabaseTransaction,
  organizationId: string,
  groupId: string,
): Promise<boolean> {
  const [organization] = await tx
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organization?.adminGroupId === groupId;
}
