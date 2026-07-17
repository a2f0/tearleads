import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { requireDirectOrganizationAccess } from "./access";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "./readModelChanges";

/**
 * Reject obvious outsiders before taking the organization write lock, then
 * re-authorize under that lock so a concurrent revocation cannot race a write.
 */
export async function requireSerializedOrganizationMutationAccess(input: {
  readonly organizationId: string;
  readonly requireAdmin?: boolean;
  readonly tx: DatabaseTransaction;
  readonly userId: string;
}): Promise<{ isOrgAdmin: boolean }> {
  const accessInput = {
    executor: input.tx,
    organizationId: input.organizationId,
    ...(input.requireAdmin === undefined
      ? {}
      : { requireAdmin: input.requireAdmin }),
    userId: input.userId,
  };
  await requireDirectOrganizationAccess(accessInput);
  const headLocked = await lockOrganizationReadModelHeadForUpdateInTransaction(
    input.tx,
    input.organizationId,
  );
  if (!headLocked) {
    throw new Error("Organization read-model cursor head is missing");
  }
  return requireDirectOrganizationAccess(accessInput);
}
