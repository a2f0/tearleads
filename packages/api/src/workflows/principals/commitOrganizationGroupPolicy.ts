import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { toMutationError } from "../containers/mutations/errors";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";
import { runPrincipalHistoryTransaction } from "./principalHistoryTransaction";
import { lockOrganizationGroupMutationInTransaction } from "./principalMutationLock";
import { principalPolicyCommitOutcome } from "./principalPolicyCommitOutcome";
import {
  loadRosterSyncTargetForPrincipal,
  type PutPrincipalPolicyInput,
} from "./principalPolicyMutationAuthorization";
import {
  assertPutPrincipalPolicyRouteBinding,
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

export async function runCommitOrganizationGroupPolicyWorkflow(
  db: ApiDatabase,
  input: {
    readonly groupId: string;
    readonly organizationId: string;
    readonly request: CommitOrganizationGroupPolicyRequest;
    readonly requesterUserId: string;
  },
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
        await requireDirectOrganizationAccess({
          executor: tx,
          organizationId: input.organizationId,
          requireAdmin: true,
          userId: input.requesterUserId,
        });
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
      const group = await putPrincipalPolicyInTransaction(tx, groupInput);
      const organization = await putPrincipalPolicyInTransaction(
        tx,
        organizationInput,
      );
      const policy = {
        groupPolicy: group.policy,
        organizationPolicy: organization.policy,
      };
      await outcome.save(policy);
      return {
        policy,
        replayed: false,
        sharedWithYouUserIds: [
          ...new Set([
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
