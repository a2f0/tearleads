import type {
  ListOrganizationGroupsResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStates,
  listCurrentPrincipalProjectionMembers,
  type StoredPrincipalProjectionMember,
} from "../../access/read/principalStateStore";
import type { ApiDatabase, DatabaseSession } from "../../adapters/postgres";
import { groups as groupsTable } from "../../schema";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import { toGroupSummary } from "./groupSummary";
import { loadUsersById, type UserKeyRow } from "./users";

interface NestedGroupRow {
  groupId: string;
  groupName: string;
}

export async function runListOrganizationGroupsWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<ListOrganizationGroupsResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });

    const groupRows = await tx
      .select({
        groupId: groupsTable.id,
        organizationId: groupsTable.organizationId,
        name: groupsTable.name,
        createdAt: groupsTable.createdAt,
      })
      .from(groupsTable)
      .where(eq(groupsTable.organizationId, organizationId))
      .orderBy(asc(groupsTable.name), asc(groupsTable.id));
    const currentStates = await getCurrentPrincipalStates(
      "group",
      groupRows.map((group) => group.groupId),
      tx,
    );

    return {
      organizationId,
      groups: groupRows.flatMap((group) => {
        if (!group.organizationId) {
          return [];
        }

        return [
          toGroupSummary({
            createdAt: group.createdAt,
            groupId: group.groupId,
            name: group.name,
            organizationId: group.organizationId,
            state: currentStates.get(group.groupId),
          }),
        ];
      }),
    };
  });
}

async function loadNestedGroupsById(input: {
  executor: DatabaseSession;
  groupMembers: ReadonlyArray<StoredPrincipalProjectionMember>;
  organizationId: string;
}): Promise<Map<string, NestedGroupRow>> {
  if (input.groupMembers.length === 0) {
    return new Map();
  }

  const rows = await input.executor
    .select({
      groupId: groupsTable.id,
      groupName: groupsTable.name,
    })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.organizationId, input.organizationId),
        inArray(
          groupsTable.id,
          input.groupMembers.map((member) => member.memberPrincipalId),
        ),
      ),
    );

  return new Map(rows.map((row) => [row.groupId, row]));
}

function toGroupMemberResponse(input: {
  groupsById: ReadonlyMap<string, NestedGroupRow>;
  member: StoredPrincipalProjectionMember;
  usersById: ReadonlyMap<string, UserKeyRow>;
}): OrganizationGroupMemberResponse {
  if (input.member.memberPrincipalType === "user") {
    const user = input.usersById.get(input.member.memberPrincipalId);

    return {
      memberPrincipalType: input.member.memberPrincipalType,
      memberPrincipalId: input.member.memberPrincipalId,
      role: input.member.role,
      userId: user?.userId ?? null,
      signingKeyFingerprint: user?.signingKeyFingerprint ?? null,
      signingPublicKey: user?.signingPublicKey ?? null,
      encapsulationPublicKey: user?.encapsulationPublicKey ?? null,
      encapsulationKeyFingerprint: user?.encapsulationKeyFingerprint ?? null,
      groupId: null,
      groupName: null,
    };
  }

  const nestedGroup = input.groupsById.get(input.member.memberPrincipalId);

  return {
    memberPrincipalType: input.member.memberPrincipalType,
    memberPrincipalId: input.member.memberPrincipalId,
    role: input.member.role,
    userId: null,
    signingKeyFingerprint: null,
    signingPublicKey: null,
    encapsulationPublicKey: null,
    encapsulationKeyFingerprint: null,
    groupId: nestedGroup?.groupId ?? null,
    groupName: nestedGroup?.groupName ?? null,
  };
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

  const [group] = await input.executor
    .select({
      groupId: groupsTable.id,
    })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.id, input.groupId),
        eq(groupsTable.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!group) {
    throw new OrganizationManagerError("Group not found", 404);
  }

  const currentState = await getCurrentPrincipalState(
    "group",
    input.groupId,
    input.executor,
  );
  if (!currentState) {
    throw new OrganizationManagerError("Group policy not found", 404);
  }

  const projection = await listCurrentPrincipalProjectionMembers(
    "group",
    input.groupId,
    input.executor,
  );
  const userMembers = projection.filter(
    (member) => member.memberPrincipalType === "user",
  );
  const groupMembers = projection.filter(
    (member) => member.memberPrincipalType === "group",
  );
  const usersById = await loadUsersById(
    input.executor,
    userMembers.map((member) => member.memberPrincipalId),
  );
  const groupsById = await loadNestedGroupsById({
    executor: input.executor,
    groupMembers,
    organizationId: input.organizationId,
  });

  return {
    organizationId: input.organizationId,
    groupId: input.groupId,
    members: projection.map((member) =>
      toGroupMemberResponse({
        groupsById,
        member,
        usersById,
      }),
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
