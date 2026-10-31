import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { loadOrganizationDescriptor } from "../organizations/organizationDescriptors";

/** Whether `groupId` is the organization's reserved Admins group. */
export async function isOrganizationAdminsGroup(
  tx: DatabaseTransaction,
  organizationId: string,
  groupId: string,
): Promise<boolean> {
  const organization = await loadOrganizationDescriptor(tx, organizationId);
  return organization?.adminGroupId === groupId;
}
