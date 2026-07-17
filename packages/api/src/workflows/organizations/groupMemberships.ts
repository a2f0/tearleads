import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { groups as groupsTable } from "@tearleads/api-shared/schema";
import type {
  OrganizationGroupMemberResponse,
  OrganizationReadModelGroupMembershipsResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { loadUsersById, type UserKeyRow } from "./users";

interface OrganizationGroupCatalogRow {
  readonly groupId: string;
  readonly groupName: string;
}

interface GroupMembershipLoadInput {
  readonly deletedGroupIds?: readonly string[];
  readonly executor: DatabaseSession;
  readonly groupIds?: readonly string[];
  readonly organizationId: string;
}

export function toOrganizationGroupMemberResponse(input: {
  readonly groupsById: ReadonlyMap<string, OrganizationGroupCatalogRow>;
  readonly member: StoredPrincipalProjectionMember;
  readonly usersById: ReadonlyMap<string, UserKeyRow>;
}): OrganizationGroupMemberResponse {
  if (input.member.memberPrincipalType === "user") {
    const user = input.usersById.get(input.member.memberPrincipalId);

    return {
      memberPrincipalType: "user",
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
    memberPrincipalType: "group",
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

async function loadOrganizationGroupRows(
  input: GroupMembershipLoadInput,
): Promise<OrganizationGroupCatalogRow[]> {
  const rows = await input.executor
    .select({
      groupId: groupsTable.id,
      groupName: groupsTable.name,
    })
    .from(groupsTable)
    .where(
      input.groupIds
        ? and(
            eq(groupsTable.organizationId, input.organizationId),
            inArray(groupsTable.id, [...input.groupIds]),
          )
        : eq(groupsTable.organizationId, input.organizationId),
    )
    .orderBy(asc(groupsTable.name), asc(groupsTable.id));
  if (
    input.groupIds &&
    new Set(rows.map((group) => group.groupId)).size !==
      new Set(input.groupIds).size
  ) {
    throw new Error("Organization group membership target is missing");
  }
  return rows;
}

function requireOrderedGroupStates(
  groupRows: readonly OrganizationGroupCatalogRow[],
  currentStates: ReadonlyMap<string, StoredPrincipalState>,
): StoredPrincipalState[] {
  return groupRows.map((group) => {
    const state = currentStates.get(group.groupId);
    if (!state) {
      throw new Error("Organization group policy state is missing");
    }
    return state;
  });
}

function indexProjectionsByGroupId(
  orderedStates: readonly StoredPrincipalState[],
  projectionsByState: ReadonlyMap<string, StoredPrincipalProjectionMember[]>,
): Map<string, StoredPrincipalProjectionMember[]> {
  const result = new Map<string, StoredPrincipalProjectionMember[]>();
  for (const projection of projectionsByState.values()) {
    const groupId = projection[0]?.principalId;
    if (groupId) {
      result.set(groupId, projection);
    }
  }
  for (const state of orderedStates) {
    if (!result.has(state.principalId)) {
      result.set(state.principalId, []);
    }
  }
  return result;
}

async function loadMemberEnrichment(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly projectionMembers: readonly StoredPrincipalProjectionMember[];
}): Promise<{
  readonly groupsById: ReadonlyMap<string, OrganizationGroupCatalogRow>;
  readonly usersById: ReadonlyMap<string, UserKeyRow>;
}> {
  const userIds = [
    ...new Set(
      input.projectionMembers.flatMap((member) =>
        member.memberPrincipalType === "user" ? [member.memberPrincipalId] : [],
      ),
    ),
  ];
  const nestedGroupIds = [
    ...new Set(
      input.projectionMembers.flatMap((member) =>
        member.memberPrincipalType === "group"
          ? [member.memberPrincipalId]
          : [],
      ),
    ),
  ];
  const usersById = await loadUsersById(input.executor, userIds);
  const nestedGroupRows =
    nestedGroupIds.length === 0
      ? []
      : await input.executor
          .select({
            groupId: groupsTable.id,
            groupName: groupsTable.name,
          })
          .from(groupsTable)
          .where(
            and(
              eq(groupsTable.organizationId, input.organizationId),
              inArray(groupsTable.id, nestedGroupIds),
            ),
          );
  return {
    groupsById: new Map(nestedGroupRows.map((group) => [group.groupId, group])),
    usersById,
  };
}

/**
 * Load the display-only group-membership projection for the organization feed.
 * Mutation authorization must continue to use the signed principal state and
 * its exact external authority, never this denormalized response.
 */
export async function loadOrganizationGroupMembershipsInTransaction(
  input: GroupMembershipLoadInput,
): Promise<OrganizationReadModelGroupMembershipsResponse> {
  if (input.groupIds?.length === 0) {
    return {
      organizationId: input.organizationId,
      deletedGroupIds: [...(input.deletedGroupIds ?? [])],
      groups: [],
    };
  }

  const groupRows = await loadOrganizationGroupRows(input);
  const currentStates = await getCurrentPrincipalStates(
    "group",
    groupRows.map((group) => group.groupId),
    input.executor,
  );
  const orderedStates = requireOrderedGroupStates(groupRows, currentStates);
  const projectionsByState = await listPrincipalProjectionMembersForStates(
    "group",
    orderedStates,
    input.executor,
  );
  const projectionsByGroupId = indexProjectionsByGroupId(
    orderedStates,
    projectionsByState,
  );
  const projectionMembers = [...projectionsByGroupId.values()].flat();
  const { groupsById, usersById } = await loadMemberEnrichment({
    executor: input.executor,
    organizationId: input.organizationId,
    projectionMembers,
  });

  return {
    organizationId: input.organizationId,
    deletedGroupIds: [...(input.deletedGroupIds ?? [])],
    groups: orderedStates.map((state) => ({
      groupId: state.principalId,
      stateHash: state.stateHash,
      members: (projectionsByGroupId.get(state.principalId) ?? []).map(
        (member) =>
          toOrganizationGroupMemberResponse({
            groupsById,
            member,
            usersById,
          }),
      ),
    })),
  };
}
