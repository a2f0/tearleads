import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";

/**
 * Gates a principal-state sync write against the owning organization's billing.
 * An `organization` principal's id is the organization itself; a `group`
 * principal resolves its organization via `groups.organizationId`. A group with
 * no organization (not org-scoped) has nothing to gate.
 */
export async function assertPrincipalOrganizationCanSync(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  userId: string,
): Promise<void> {
  if (principalType === "organization") {
    await assertOrganizationCanSync(executor, principalId, userId);
    return;
  }

  const [group] = await executor
    .select({ organizationId: groups.organizationId })
    .from(groups)
    .where(eq(groups.id, principalId))
    .limit(1);
  if (group?.organizationId) {
    await assertOrganizationCanSync(executor, group.organizationId, userId);
  }
}
