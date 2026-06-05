import type {
  DeleteOrganizationGroupResponse,
  ListOrganizationGroupsResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStates,
  listCurrentPrincipalProjectionMembers,
  type StoredPrincipalProjectionMember,
} from "../../access/read/principalStateStore";
import type { ApiDatabase, DatabaseSession } from "../../adapters/postgres";
import {
  groups as groupsTable,
  organizations,
  principalEpochKeys,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "../../schema";
import { requireDirectOrganizationAccess } from "./access";
import {
  listOrganizationContainerGrantRows,
  toOrganizationGroupContainerResponse,
} from "./containerGrants";
import { OrganizationManagerError } from "./errors";
import { toGroupSummary } from "./groupSummary";
import { loadUsersById, type UserKeyRow } from "./users";

interface NestedGroupRow {
  groupId: string;
  groupName: string;
}

interface OrganizationGroupSummariesResult {
  readonly groups: OrganizationGroupSummaryResponse[];
  readonly memberGroupId: string;
}

interface OrganizationGroupMutationInput {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
}

function readReferenceCount(row: unknown): number {
  if (!row || typeof row !== "object") {
    throw new Error("Unexpected organization group reference row shape");
  }

  const referenceCount = Reflect.get(row, "referenceCount");
  if (typeof referenceCount === "number" && Number.isInteger(referenceCount)) {
    return referenceCount;
  }
  if (typeof referenceCount === "string" && referenceCount.length > 0) {
    const parsedReferenceCount = Number(referenceCount);
    if (Number.isInteger(parsedReferenceCount)) {
      return parsedReferenceCount;
    }
  }

  throw new Error("Unexpected organization group reference row shape");
}

async function hasCurrentPrincipalReferences(input: {
  executor: DatabaseSession;
  groupId: string;
}): Promise<boolean> {
  const result = await input.executor.execute(sql`
    with current_managed_principal_states as (
      select distinct on (principal_type, principal_id)
        principal_type,
        principal_id,
        state_hash
      from ${principalStates}
      where principal_type in (${"group"}, ${"organization"})
      order by principal_type asc, principal_id asc, version desc
    )
    select count(*)::int as "referenceCount"
    from ${principalMembershipProjection} pmp
    inner join current_managed_principal_states current_state
      on current_state.principal_type = pmp.principal_type
      and current_state.principal_id = pmp.principal_id
      and current_state.state_hash = pmp.state_hash
    where
      pmp.member_principal_type = ${"group"}
      and pmp.member_principal_id = ${input.groupId}
  `);

  return readReferenceCount(result.rows[0]) > 0;
}

async function requireDeletableOrganizationGroup(
  input: OrganizationGroupMutationInput,
): Promise<void> {
  const [organization] = await input.executor
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) {
    throw new OrganizationManagerError("Organization not found", 404);
  }

  const [group] = await input.executor
    .select({ groupId: groupsTable.id })
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

  if (
    input.groupId === organization.adminGroupId ||
    input.groupId === organization.memberGroupId
  ) {
    throw new OrganizationManagerError(
      "Built-in groups cannot be deleted",
      409,
    );
  }
}

async function requireOrganizationGroupWithoutDeleteBlockers(
  input: OrganizationGroupMutationInput,
): Promise<void> {
  const directContainerGrants = await listOrganizationContainerGrantRows({
    executor: input.executor,
    organizationId: input.organizationId,
    subjectFilter: {
      subjectId: input.groupId,
      subjectType: "group",
    },
  });
  if (directContainerGrants.length > 0) {
    throw new OrganizationManagerError(
      "Group has direct container grants",
      409,
    );
  }

  if (
    await hasCurrentPrincipalReferences({
      executor: input.executor,
      groupId: input.groupId,
    })
  ) {
    throw new OrganizationManagerError(
      "Group is referenced by current principal policy",
      409,
    );
  }
}

async function deleteOrganizationGroupRows(input: {
  executor: DatabaseSession;
  groupId: string;
}): Promise<void> {
  await input.executor
    .delete(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, "group"),
        eq(principalMemberEnvelopes.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, "group"),
        eq(principalMembershipProjection.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, "group"),
        eq(principalStatePayloads.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, "group"),
        eq(principalEpochKeys.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "group"),
        eq(principalStates.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(groupsTable)
    .where(eq(groupsTable.id, input.groupId));
}

async function requireGroupInOrganization(input: {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
}): Promise<void> {
  const [group] = await input.executor
    .select({ groupId: groupsTable.id })
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
    const groupSummaries = await listOrganizationGroupSummariesInTransaction({
      executor: tx,
      organizationId,
    });

    return {
      organizationId,
      memberGroupId: groupSummaries.memberGroupId,
      groups: groupSummaries.groups,
    };
  });
}

export async function runDeleteOrganizationGroupWorkflow(
  db: ApiDatabase,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<DeleteOrganizationGroupResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });
    await requireDeletableOrganizationGroup({
      executor: tx,
      groupId,
      organizationId,
    });
    await requireOrganizationGroupWithoutDeleteBlockers({
      executor: tx,
      groupId,
      organizationId,
    });
    await deleteOrganizationGroupRows({ executor: tx, groupId });

    return {
      deleted: true,
      groupId,
      organizationId,
    };
  });
}

export async function listOrganizationGroupSummariesInTransaction(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<OrganizationGroupSummariesResult> {
  const [organization] = await input.executor
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!organization) {
    throw new OrganizationManagerError("Organization not found", 404);
  }

  const groupRows = await input.executor
    .select({
      groupId: groupsTable.id,
      organizationId: groupsTable.organizationId,
      name: groupsTable.name,
      createdAt: groupsTable.createdAt,
    })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.organizationId, input.organizationId),
        notInArray(groupsTable.id, [organization.memberGroupId]),
      ),
    )
    .orderBy(asc(groupsTable.name), asc(groupsTable.id));
  const currentStates = await getCurrentPrincipalStates(
    "group",
    groupRows.map((group) => group.groupId),
    input.executor,
  );

  return {
    memberGroupId: organization.memberGroupId,
    groups: groupRows.flatMap((group) => {
      if (!group.organizationId) {
        return [];
      }

      return [
        toGroupSummary({
          createdAt: group.createdAt,
          groupId: group.groupId,
          isBuiltin: group.groupId === organization.adminGroupId,
          name: group.name,
          organizationId: group.organizationId,
          state: currentStates.get(group.groupId),
        }),
      ];
    }),
  };
}

async function listOrganizationGroupContainersInTransaction(input: {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
  sessionUserId: string;
}): Promise<OrganizationGroupContainersResponse> {
  await requireDirectOrganizationAccess({
    executor: input.executor,
    organizationId: input.organizationId,
    userId: input.sessionUserId,
  });
  await requireGroupInOrganization({
    executor: input.executor,
    groupId: input.groupId,
    organizationId: input.organizationId,
  });

  const rows = await listOrganizationContainerGrantRows({
    executor: input.executor,
    organizationId: input.organizationId,
    subjectFilter: {
      subjectId: input.groupId,
      subjectType: "group",
    },
  });

  return {
    organizationId: input.organizationId,
    groupId: input.groupId,
    containers: rows.map((row) => toOrganizationGroupContainerResponse(row)),
  };
}

export async function runListOrganizationGroupContainersWorkflow(
  db: ApiDatabase,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<OrganizationGroupContainersResponse> {
  return db.transaction((tx) =>
    listOrganizationGroupContainersInTransaction({
      executor: tx,
      groupId,
      organizationId,
      sessionUserId,
    }),
  );
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

  await requireGroupInOrganization(input);

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
