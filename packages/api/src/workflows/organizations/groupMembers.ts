import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import type { OrganizationGroupMembersResponse } from "@tearleads/validators/response";
import { and, asc, eq, sql } from "drizzle-orm";
import { currentPrincipalStateHashSql } from "../principals/currentPrincipalStateSql";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";

/**
 * The group, its current policy head and that head's members in one
 * statement: no row means the group is not in the organization, a null head
 * means it has no policy, and a null member means the head has no members.
 */
async function loadGroupHeadMembers(input: {
  readonly executor: DatabaseSession;
  readonly groupId: string;
  readonly organizationId: string;
}) {
  const member = principalMembershipProjection;
  return input.executor
    .select({
      role: member.role,
      stateHash: principalStates.stateHash,
      userId: member.userId,
    })
    .from(groupsTable)
    .leftJoin(
      principalStates,
      and(
        eq(principalStates.principalType, "group"),
        eq(principalStates.principalId, groupsTable.id),
        eq(
          principalStates.stateHash,
          currentPrincipalStateHashSql({
            principalId: sql`${groupsTable.id}`,
            principalType: sql`'group'`,
          }),
        ),
      ),
    )
    .leftJoin(
      member,
      and(
        eq(member.principalType, "group"),
        eq(member.principalId, groupsTable.id),
        eq(member.stateHash, principalStates.stateHash),
      ),
    )
    .where(
      and(
        eq(groupsTable.id, input.groupId),
        eq(groupsTable.organizationId, input.organizationId),
      ),
    )
    .orderBy(asc(member.userId));
}

async function listOrganizationGroupMembersInTransaction(input: {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
  sessionUserId: string;
}): Promise<OrganizationGroupMembersResponse> {
  await requireDirectOrganizationAccess({
    executor: input.executor,
    organizationId: input.organizationId,
    userId: input.sessionUserId,
  });
  const rows = await loadGroupHeadMembers(input);
  const [first] = rows;
  if (!first) {
    throw new OrganizationManagerError("Group not found", 404);
  }
  if (first.stateHash === null) {
    throw new OrganizationManagerError("Group policy not found", 404);
  }

  return {
    organizationId: input.organizationId,
    groupId: input.groupId,
    members: rows.flatMap(({ role, userId }) =>
      role === null || userId === null ? [] : [{ role, userId }],
    ),
  };
}

export async function runListOrganizationGroupMembersWorkflow(
  db: ApiDatabase,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<OrganizationGroupMembersResponse> {
  return db.transaction((tx) =>
    listOrganizationGroupMembersInTransaction({
      executor: tx,
      groupId,
      organizationId,
      sessionUserId,
    }),
  );
}
