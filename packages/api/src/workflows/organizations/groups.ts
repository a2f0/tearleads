import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizations,
} from "@tearleads/api-shared/schema";
import type {
  DeleteOrganizationGroupResponse,
  ListOrganizationGroupsResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, notInArray } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStates,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { lockGroupReferenceExclusiveInTransaction } from "../principals/groupReferenceLock";
import { lockPrincipalMutationInTransaction } from "../principals/principalMutationLock";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import {
  deleteOrganizationGroupRows,
  requireDeletableOrganizationGroup,
  requireOrganizationGroupWithoutDeleteBlockers,
} from "./groupDeletion";
import { toOrganizationGroupMemberResponse } from "./groupMemberships";
import { toGroupSummary } from "./groupSummary";
import {
  requireSerializedOrganizationMutationAccess,
  withOrganizationAdminTransaction,
} from "./mutationAccess";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";
import { loadUsersById } from "./users";

interface OrganizationGroupSummariesResult {
  readonly groups: OrganizationGroupSummaryResponse[];
  readonly memberGroupId: string;
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

export async function loadOrganizationGroupsInTransaction(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<ListOrganizationGroupsResponse> {
  const groupSummaries =
    await listOrganizationGroupSummariesInTransaction(input);

  return {
    organizationId: input.organizationId,
    memberGroupId: groupSummaries.memberGroupId,
    groups: groupSummaries.groups,
  };
}

export async function runDeleteOrganizationGroupWorkflow(
  db: ApiDatabase,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<DeleteOrganizationGroupResponse> {
  return withOrganizationAdminTransaction(
    db,
    { organizationId, userId: sessionUserId },
    async (tx) => {
      await lockPrincipalMutationInTransaction(tx, "group", groupId);
      await lockGroupReferenceExclusiveInTransaction(tx, groupId);
      await requireSerializedOrganizationMutationAccess({
        organizationId,
        requireAdmin: true,
        tx,
        userId: sessionUserId,
      });
      await assertOrganizationCanSync(tx, organizationId, sessionUserId);
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
      await deleteOrganizationGroupRows({
        executor: tx,
        groupId,
        organizationId,
      });
      await appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId,
        lane: "groups",
        entityId: groupId,
        operation: "delete",
      });
      await appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId,
        lane: "groupMemberships",
        entityId: groupId,
        operation: "delete",
      });

      return {
        deleted: true,
        groupId,
        organizationId,
      };
    },
  );
}

async function listOrganizationGroupSummariesInTransaction(input: {
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
  const usersById = await loadUsersById(
    input.executor,
    projection.map((member) => member.userId),
  );

  return {
    organizationId: input.organizationId,
    groupId: input.groupId,
    members: projection.map((member) =>
      toOrganizationGroupMemberResponse({
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
