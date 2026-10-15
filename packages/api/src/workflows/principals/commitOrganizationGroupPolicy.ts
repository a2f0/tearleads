import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { toMutationError } from "../containers/mutations/errors";
import { OrganizationManagerError } from "../organizations/errors";
import {
  lockGroupPolicyRematerializationInTransaction,
  lockGroupReferenceExclusiveInTransaction,
  sortGroupReferenceIds,
} from "./groupReferenceLock";
import { runPrincipalHistoryTransaction } from "./principalHistoryTransaction";
import {
  lockOrganizationGroupMutationInTransaction,
  lockPrincipalMutationInTransaction,
} from "./principalMutationLock";
import { principalPolicyCommitOutcome } from "./principalPolicyCommitOutcome";
import {
  loadRosterSyncTargetForPrincipal,
  type PutPrincipalPolicyInput,
} from "./principalPolicyMutationAuthorization";
import {
  assertPutPrincipalPolicyRouteBinding,
  preparePrincipalPolicyInTransaction,
  putPrincipalPolicyInTransaction,
} from "./putPrincipalPolicy";
import {
  PrincipalPolicyError,
  principalPolicyErrorFromContainerMutation,
  toPrincipalPolicyError,
} from "./shared";

export interface CommitOrganizationGroupPolicyResult {
  readonly policy: CommitOrganizationGroupPolicyResponse;
  readonly replayed: boolean;
  readonly sharedWithYouUserIds: readonly string[];
}

interface CommitPolicyInput {
  readonly groupId: string;
  readonly organizationId: string;
  readonly request: CommitOrganizationGroupPolicyRequest;
  readonly requesterUserId: string;
}

async function lockEnrollmentReferences(
  tx: DatabaseTransaction,
  input: CommitPolicyInput,
  memberGroupId: string,
): Promise<void> {
  if (!input.request.memberPolicy) return;
  // Container grants acquire shared references in this same order.
  // Lock both before either policy takes its own reference or org row.
  await lockGroupPolicyRematerializationInTransaction(tx);
  for (const groupId of sortGroupReferenceIds([input.groupId, memberGroupId])) {
    await lockGroupReferenceExclusiveInTransaction(tx, groupId);
  }
}

async function commitRosterEnrollment(
  tx: DatabaseTransaction,
  input: CommitPolicyInput,
  memberGroupId: string,
) {
  const memberInput = input.request.memberPolicy
    ? {
        ...input.request.memberPolicy,
        expectedPrincipalId: memberGroupId,
        expectedPrincipalType: "group" as const,
        requesterUserId: input.requesterUserId,
      }
    : null;
  if (memberInput) {
    assertPutPrincipalPolicyRouteBinding(memberInput);
    if (input.groupId === memberGroupId) {
      throw new PrincipalPolicyError("Members policy is duplicated", 400);
    }
    await lockPrincipalMutationInTransaction(tx, "group", memberGroupId);
  }
  return memberInput
    ? await putPrincipalPolicyInTransaction(tx, memberInput)
    : null;
}

export async function runCommitOrganizationGroupPolicyWorkflow(
  db: ApiDatabase,
  input: CommitPolicyInput,
): Promise<CommitOrganizationGroupPolicyResult> {
  const groupInput: PutPrincipalPolicyInput = {
    ...input.request.groupPolicy,
    expectedPrincipalId: input.groupId,
    expectedPrincipalType: "group",
    requesterUserId: input.requesterUserId,
  };
  const organizationInput: PutPrincipalPolicyInput = {
    ...input.request.organizationPolicy,
    expectedPrincipalId: input.organizationId,
    expectedPrincipalType: "organization",
    requesterUserId: input.requesterUserId,
  };
  assertPutPrincipalPolicyRouteBinding(groupInput);
  assertPutPrincipalPolicyRouteBinding(organizationInput);

  try {
    return await runPrincipalHistoryTransaction(db, async (tx) => {
      await lockOrganizationGroupMutationInTransaction(
        tx,
        input.organizationId,
        input.groupId,
      );
      const outcome = await principalPolicyCommitOutcome(tx, input);
      if (outcome.response) {
        return {
          policy: outcome.response,
          sharedWithYouUserIds: [],
          replayed: true,
        };
      }
      const target = await loadRosterSyncTargetForPrincipal({
        input: groupInput,
        tx,
      });
      if (!target || target.organizationId !== input.organizationId) {
        throw new PrincipalPolicyError(
          "Group does not belong to the committed organization",
          404,
        );
      }
      await lockEnrollmentReferences(tx, input, target.memberGroupId);
      // Both group operations authorize against the intact predecessor directory.
      // The organization lock remains held through all three policy writes.
      const applyGroup = await preparePrincipalPolicyInTransaction(
        tx,
        groupInput,
      );
      const member = await commitRosterEnrollment(
        tx,
        input,
        target.memberGroupId,
      );
      const group = await applyGroup();
      const organization = await putPrincipalPolicyInTransaction(
        tx,
        organizationInput,
      );
      const policy = {
        ...(member ? { memberPolicy: member.policy } : {}),
        groupPolicy: group.policy,
        organizationPolicy: organization.policy,
      };
      await outcome.save(policy);
      return {
        policy,
        replayed: false,
        sharedWithYouUserIds: [
          ...new Set([
            ...(member?.sharedWithYouUserIds ?? []),
            ...group.sharedWithYouUserIds,
            ...organization.sharedWithYouUserIds,
          ]),
        ],
      };
    });
  } catch (error) {
    const containerMutationError = toMutationError(error);
    if (containerMutationError) {
      throw principalPolicyErrorFromContainerMutation(containerMutationError);
    }
    if (error instanceof OrganizationManagerError) {
      throw new PrincipalPolicyError(error.message, error.status, error.code);
    }
    const principalPolicyError = toPrincipalPolicyError(error);
    if (principalPolicyError) {
      throw principalPolicyError;
    }
    throw error;
  }
}
