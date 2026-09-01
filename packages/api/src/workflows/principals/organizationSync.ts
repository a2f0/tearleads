import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { assertOrganizationIsSyncEntitled } from "../billing/organizationSyncEligibility";

/**
 * Gates principal-state control-plane writes on organization entitlement, but
 * not on the caller's content-sync seat. This leaves authorized admins able to
 * remove a member and recover capacity. An `organization` principal's id is the
 * organization itself; a `group` resolves through `groups.organizationId`.
 */
export async function assertPrincipalOrganizationIsSyncEntitled(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): Promise<void> {
  if (principalType === "organization") {
    await assertOrganizationIsSyncEntitled(executor, principalId);
    return;
  }

  const [group] = await executor
    .select({ organizationId: groups.organizationId })
    .from(groups)
    .where(eq(groups.id, principalId))
    .limit(1);
  if (group?.organizationId) {
    await assertOrganizationIsSyncEntitled(executor, group.organizationId);
  }
}
