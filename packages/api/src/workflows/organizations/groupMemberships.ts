import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizationGroupTombstones,
} from "@tearleads/api-shared/schema";
import type { OrganizationReadModelGroupMembershipsResponse } from "@tearleads/validators/response";
import { and, asc, eq, gt } from "drizzle-orm";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";

interface OrganizationGroupCatalogRow {
  readonly groupId: string;
}

interface GroupMembershipLoadInput {
  /** Load only groups whose membership changed after this cursor. */
  readonly changedAfterCursor?: bigint;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}

async function loadOrganizationGroupRows(
  input: GroupMembershipLoadInput,
): Promise<OrganizationGroupCatalogRow[]> {
  const rows = await input.executor
    .select({
      groupId: groupsTable.id,
    })
    .from(groupsTable)
    .where(
      input.changedAfterCursor === undefined
        ? eq(groupsTable.organizationId, input.organizationId)
        : and(
            eq(groupsTable.organizationId, input.organizationId),
            gt(groupsTable.membershipCursor, input.changedAfterCursor),
          ),
    )
    .orderBy(asc(groupsTable.id));
  return rows;
}

async function loadDeletedGroupIdsAfter(input: {
  readonly cursor: bigint;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<string[]> {
  const rows = await input.executor
    .select({ groupId: organizationGroupTombstones.groupId })
    .from(organizationGroupTombstones)
    .where(
      and(
        eq(organizationGroupTombstones.organizationId, input.organizationId),
        gt(organizationGroupTombstones.deletedCursor, input.cursor),
      ),
    );
  return rows.map((row) => row.groupId);
}

function listOrderedGroupStates(
  groupRows: readonly OrganizationGroupCatalogRow[],
  currentStates: ReadonlyMap<string, StoredPrincipalState>,
): StoredPrincipalState[] {
  return groupRows.flatMap((group) => {
    const state = currentStates.get(group.groupId);
    return state ? [state] : [];
  });
}

/**
 * A delta reports tombstoned groups and changed group rows that have no
 * current state as deletions; a snapshot omits both.
 */
async function listDeletedGroupIds(
  input: GroupMembershipLoadInput,
  groupRows: readonly OrganizationGroupCatalogRow[],
  currentStates: ReadonlyMap<string, StoredPrincipalState>,
): Promise<string[]> {
  if (input.changedAfterCursor === undefined) {
    return [];
  }
  const deletedGroupIds = new Set(
    await loadDeletedGroupIdsAfter({
      cursor: input.changedAfterCursor,
      executor: input.executor,
      organizationId: input.organizationId,
    }),
  );
  for (const { groupId } of groupRows) {
    if (!currentStates.has(groupId)) {
      deletedGroupIds.add(groupId);
    }
  }
  return [...deletedGroupIds].sort();
}

function indexProjectionsByGroupId(
  orderedStates: readonly StoredPrincipalState[],
  projectionsByState: ReadonlyMap<string, StoredPrincipalProjectionMember[]>,
): Map<string, StoredPrincipalProjectionMember[]> {
  const result = new Map<string, StoredPrincipalProjectionMember[]>();
  for (const state of orderedStates) {
    result.set(state.principalId, []);
  }
  for (const projections of projectionsByState.values()) {
    for (const member of projections) {
      result.get(member.principalId)?.push(member);
    }
  }
  return result;
}

/**
 * Load the display-only group-membership projection for the organization feed.
 * Members carry only user and role; their public keys travel once per user in
 * the directory lane. Mutation authorization must continue to use the signed
 * principal state and its exact external authority, never this response.
 */
export async function loadOrganizationGroupMembershipsInTransaction(
  input: GroupMembershipLoadInput,
): Promise<OrganizationReadModelGroupMembershipsResponse> {
  const groupRows = await loadOrganizationGroupRows(input);
  const currentStates = await getCurrentPrincipalStates(
    "group",
    groupRows.map((group) => group.groupId),
    input.executor,
  );
  const orderedStates = listOrderedGroupStates(groupRows, currentStates);
  const deletedGroupIds = await listDeletedGroupIds(
    input,
    groupRows,
    currentStates,
  );
  const projectionsByState = await listPrincipalProjectionMembersForStates(
    "group",
    orderedStates,
    input.executor,
  );
  const projectionsByGroupId = indexProjectionsByGroupId(
    orderedStates,
    projectionsByState,
  );

  return {
    organizationId: input.organizationId,
    deletedGroupIds,
    groups: orderedStates.map((state) => ({
      groupId: state.principalId,
      stateHash: state.stateHash,
      members: (projectionsByGroupId.get(state.principalId) ?? []).map(
        ({ role, userId }) => ({ role, userId }),
      ),
    })),
  };
}
