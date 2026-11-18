import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { DeleteOrganizationGroupRequest } from "@tearleads/validators/request";
import type {
  DeleteOrganizationGroupResponse,
  ListOrganizationGroupsResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { lockGroupReferenceExclusiveInTransaction } from "../principals/groupReferenceLock";
import { rebuildOrganizationLegMemberEnvelopes } from "../principals/memberEnvelopeReferences";
import { PrincipalHistoryPreparationUnavailable } from "../principals/principalHistoryPreparationUnavailable";
import { runPrincipalHistoryTransaction } from "../principals/principalHistoryTransaction";
import { lockOrganizationGroupMutationInTransaction } from "../principals/principalMutationLock";
import {
  assertPutPrincipalPolicyRouteBinding,
  putPrincipalPolicyInTransaction,
} from "../principals/putPrincipalPolicy";
import {
  PrincipalPolicyError,
  toPrincipalPolicyError,
} from "../principals/shared";
import {
  type OrganizationGroupIds,
  requireDirectOrganizationAccess,
} from "./access";
import { OrganizationManagerError } from "./errors";
import {
  loadOrganizationGroupCatalog,
  type OrganizationGroupCatalog,
} from "./groupCatalog";
import {
  deleteOrganizationGroupRows,
  requireDeletableOrganizationGroup,
  requireOrganizationGroupWithoutDeleteBlockers,
} from "./groupDeletion";
import { toGroupSummary } from "./groupSummary";
import { requireSerializedOrganizationMutationAccess } from "./mutationAccess";
import { organizationGroupDeletionOutcome } from "./organizationGroupOperationOutcome";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";

interface OrganizationGroupSummariesResult {
  readonly groups: OrganizationGroupSummaryResponse[];
  readonly memberGroupId: string;
}

export async function loadOrganizationGroupsInTransaction(input: {
  readonly executor: DatabaseSession;
  /** The immutable reserved group ids the caller's access check read. */
  readonly organization: OrganizationGroupIds;
  readonly organizationId: string;
  readonly catalog?: OrganizationGroupCatalog;
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
  readonly identityTrustDomain: string;
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
  const outcome = await organizationGroupDeletionOutcome(input.tx, input);
  if (outcome.response) return outcome.response;
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
  const organization = await putPrincipalPolicyInTransaction(
    input.tx,
    {
      ...input.request.organizationPolicy,
      expectedPrincipalId: input.organizationId,
      expectedPrincipalType: "organization",
      requesterUserId: input.sessionUserId,
    },
    input.identityTrustDomain,
  );
  await appendOrganizationReadModelChangeInTransaction(input.tx, {
    deletedGroupIds: [input.groupId],
    lanes: ["groups"],
    organizationId: input.organizationId,
  });
  const result: DeleteOrganizationGroupResponse = {
    deleted: true,
    groupId: input.groupId,
    organizationPolicy: organization.policy,
    organizationId: input.organizationId,
  };
  await outcome.save(result);
  return result;
}

export async function runDeleteOrganizationGroupWorkflow(
  db: ApiDatabase,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
  input: DeleteOrganizationGroupRequest,
  identityTrustDomain: string,
): Promise<DeleteOrganizationGroupResponse> {
  try {
    return await runPrincipalHistoryTransaction(db, async (tx) => {
      await requireDirectOrganizationAccess({
        executor: tx,
        organizationId,
        requireAdmin: true,
        userId: sessionUserId,
      });
      return deleteOrganizationGroupInTransaction({
        identityTrustDomain,
        groupId,
        organizationId,
        request: {
          ...input,
          organizationPolicy: await rebuildOrganizationLegMemberEnvelopes(
            tx,
            { organizationId, requesterUserId: sessionUserId },
            input.organizationPolicy,
          ),
        },
        sessionUserId,
        tx,
      });
    });
  } catch (error) {
    if (error instanceof PrincipalHistoryPreparationUnavailable) throw error;
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
  readonly executor: DatabaseSession;
  readonly organization: OrganizationGroupIds;
  readonly organizationId: string;
  readonly catalog?: OrganizationGroupCatalog;
}): Promise<OrganizationGroupSummariesResult> {
  const { organization } = input;
  const { groupRows, currentStates } =
    input.catalog ??
    (await loadOrganizationGroupCatalog(
      input.executor,
      input.organizationId,
      organization.memberGroupId,
    ));

  return {
    memberGroupId: organization.memberGroupId,
    groups: groupRows.flatMap((group) => {
      if (
        !group.organizationId ||
        group.groupId === organization.memberGroupId
      ) {
        return [];
      }

      return [
        toGroupSummary({
          createdAt: group.createdAt,
          groupId: group.groupId,
          isBuiltin: group.groupId === organization.adminGroupId,
          organizationId: group.organizationId,
          state: currentStates.get(group.groupId),
        }),
      ];
    }),
  };
}
