import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { listUsersReachableFromCurrentPrincipal } from "../organizations/principalReachability";
import { PrincipalPolicyError } from "./shared";

/**
 * Roster constraints on the users a managed principal may name.
 *
 * Two different rules, because they always were two different rules:
 *
 * - No managed principal may name a *disabled* roster user. Disabling is how an
 *   organization revokes someone; letting a group re-admit them would undo it.
 * - The reserved `Admins` group may name only *active* roster users. Nesting
 *   used to make this structural — `Members` contained `Admins`, so an admin was
 *   reachable from `Members` and therefore always an organization member, on the
 *   directory and counted as a seat. Nesting is gone, so nothing but this check
 *   stops an admin from existing on no roster at all: invisible to the
 *   directory, and uncounted by billing, which derives seats from `Members`.
 *
 * The second rule is deliberately scoped to `Admins`. Ordinary groups could
 * always name a user who was not in `Members` — nesting never implied otherwise
 * — and widening the rule to every group would change who gets billed.
 */
export async function assertManagedPrincipalRosterMembership(input: {
  readonly organizationId: string;
  readonly principalId: string;
  readonly principalType: "group" | "organization";
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const reachableUserIds = await listUsersReachableFromCurrentPrincipal({
    executor: input.tx,
    principalId: input.principalId,
    principalType: input.principalType,
  });
  if (reachableUserIds.length === 0) {
    return;
  }

  const rosterRows = await input.tx
    .select({
      status: organizationRosterEntries.status,
      userId: organizationRosterEntries.userId,
    })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, input.organizationId),
        inArray(organizationRosterEntries.userId, reachableUserIds),
      ),
    );

  if (rosterRows.some((row) => row.status === "disabled")) {
    throw new PrincipalPolicyError(
      "Principal contains disabled organization users",
      409,
    );
  }

  if (input.principalType !== "group") {
    return;
  }
  const [organization] = await input.tx
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (organization?.adminGroupId !== input.principalId) {
    return;
  }

  const activeUserIds = new Set(
    rosterRows
      .filter((row) => row.status === "active")
      .map((row) => row.userId),
  );
  if (reachableUserIds.some((userId) => !activeUserIds.has(userId))) {
    throw new PrincipalPolicyError(
      "Admins contains users who are not active organization members",
      409,
    );
  }
}

/**
 * Re-validates the reserved `Admins` group after a `Members` transition.
 *
 * Removing someone from `Members` takes them off the roster but leaves every
 * other group they belong to untouched — including `Admins`. Without this, that
 * one write produces exactly what the Admins rule exists to prevent: an admin
 * with no roster entry, invisible to the directory and absent from the invoice,
 * still holding admin authority. Remove them from `Admins` first; the disable
 * flow already does, in that order.
 */
export async function assertOrganizationAdminsRosterMembership(input: {
  readonly organizationId: string;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const [organization] = await input.tx
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) {
    return;
  }
  await assertManagedPrincipalRosterMembership({
    organizationId: input.organizationId,
    principalId: organization.adminGroupId,
    principalType: "group",
    tx: input.tx,
  });
}
