import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationRosterEntries,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { listUsersReachableFromCurrentPrincipal } from "../organizations/principalReachability";
import { currentPrincipalStateHashSql } from "./currentPrincipalStateSql";
import { PrincipalPolicyError } from "./shared";

/**
 * Every managed principal may name only active users in its own organization.
 * Members writes first synchronize the roster, so enrollment remains explicit;
 * creating or editing an ordinary group never implicitly enrolls someone.
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

  const activeUserIds = new Set(
    rosterRows
      .filter((row) => row.status === "active")
      .map((row) => row.userId),
  );
  if (reachableUserIds.some((userId) => !activeUserIds.has(userId))) {
    throw new PrincipalPolicyError(
      "Principal contains users who are not active organization members",
      409,
    );
  }
}

/**
 * Re-validates all live groups after a Members transition under the same
 * organization mutation lock. Signed removals from other groups must precede
 * roster removal; a rejected transition rolls back the policy and roster.
 * Only current projections count, not retained historical membership.
 */
export async function assertOrganizationGroupsRosterMembership(input: {
  readonly organizationId: string;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const member = principalMembershipProjection;
  const roster = organizationRosterEntries;
  const [invalid] = await input.tx
    .select({ status: roster.status })
    .from(groups)
    .innerJoin(
      member,
      and(
        eq(member.principalType, "group"),
        eq(member.principalId, groups.id),
        eq(
          member.stateHash,
          currentPrincipalStateHashSql({
            principalId: sql`${groups.id}`,
            principalType: sql`'group'`,
          }),
        ),
      ),
    )
    .leftJoin(
      roster,
      and(
        eq(roster.organizationId, groups.organizationId),
        eq(roster.userId, member.userId),
      ),
    )
    .where(
      and(
        eq(groups.organizationId, input.organizationId),
        or(isNull(roster.status), ne(roster.status, "active")),
      ),
    )
    .limit(1);
  if (invalid) {
    throw new PrincipalPolicyError(
      "Remove users from other organization groups before removing them from Members",
      409,
    );
  }
}
