import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import {
  groups as groupsTable,
  organizations,
} from "@symcrypt/api-shared/schema";
import type { DeleteOrganizationGroupRequest } from "@symcrypt/validators/request";
import type {
  DeleteOrganizationGroupResponse,
  ListOrganizationGroupsResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@symcrypt/validators/response";
import { and, asc, eq, notInArray } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStates,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { lockGroupReferenceExclusiveInTransaction } from "../principals/groupReferenceLock";
import { lockOrganizationGroupMutationInTransaction } from "../principals/principalMutationLock";
import {
  assertPutPrincipalPolicyRouteBinding,
  putPrincipalPolicyInTransaction,
} from "../principals/putPrincipalPolicy";
import {
  PrincipalPolicyError,
  toPrincipalPolicyError,
} from "../principals/shared";
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

function assertDeleteOrganizationGroupPolicyBinding(input: {
  readonly organizationId: string;
  readonly request: DeleteOrganizationGroupRequest;
  readonly sessionUserId: string;
}): void {
  try {
    assertPutPrincipalPolicyRouteBinding({
      ...input.request.organizationPolicy,
      expectedPrincipalId: input.organizationId,
      expectedPrincipalType: "organization",
      requesterUserId: input.sessionUserId,
    });
  } catch (error) {
    if (error instanceof PrincipalPolicyError) {
      throw new OrganizationManagerError(error.message, error.status);
    }
    throw error;
  }
}

async function deleteOrganizationGroupInTransaction(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly request: DeleteOrganizationGroupRequest;
  readonly sessionUserId: string;
  readonly tx: DatabaseTransaction;
}): Promise<DeleteOrganizationGroupResponse> {
  assertDeleteOrganizationGroupPolicyBinding({
    organizationId: input.organizationId,
    request: input.request,
    sessionUserId: input.sessionUserId,
  });
  await lockOrganizationGroupMutationInTransaction(
    input.tx,
    input.organizationId,
    input.groupId,
  );
  await lockGroupReferenceExclusiveInTransaction(input.tx, input.groupId);
  await requireSerializedOrganizationMutationAccess({
    organizationId: input.organizationId,
    requireAdmin: true,
    tx: input.tx,
    userId: input.sessionUserId,
  });
  await assertOrganizationCanSync(
    input.tx,
    input.organizationId,
    input.sessionUserId,
  );
  await requireDeletableOrganizationGroup({
    executor: input.tx,
    groupId: input.groupId,
    organizationId: input.organizationId,
  });
  await requireOrganizationGroupWithoutDeleteBlockers({
    executor: input.tx,
    groupId: input.groupId,
    organizationId: input.organizationId,
  });
  await deleteOrganizationGroupRows({
    executor: input.tx,
    groupId: input.groupId,
    organizationId: input.organizationId,
  });
  const organization = await putPrincipalPolicyInTransaction(input.tx, {
    ...input.request.organizationPolicy,
    expectedPrincipalId: input.organizationId,
    expectedPrincipalType: "organization",
    requesterUserId: input.sessionUserId,
  });
  for (const lane of ["groups", "groupMemberships"] as const) {
    await appendOrganizationReadModelChangeInTransaction(input.tx, {
      organizationId: input.organizationId,
      lane,
      entityId: input.groupId,
      operation: "delete",
    });
  }
  return {
    deleted: true,
    groupId: input.groupId,
    organizationPolicy: organization.policy,
    organizationId: input.organizationId,
  };
}

export async function runDeleteOrganizationGroupWorkflow(
  db: ApiDatabase,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
  input: DeleteOrganizationGroupRequest,
): Promise<DeleteOrganizationGroupResponse> {
  try {
    return await withOrganizationAdminTransaction(
      db,
      { organizationId, userId: sessionUserId },
      (tx) =>
        deleteOrganizationGroupInTransaction({
          groupId,
          organizationId,
          request: input,
          sessionUserId,
          tx,
        }),
    );
  } catch (error) {
    const policyError =
      error instanceof PrincipalPolicyError
        ? error
        : toPrincipalPolicyError(error);
    if (policyError) {
      throw new OrganizationManagerError(
        policyError.message,
        policyError.status,
      );
    }
    throw error;
  }
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
