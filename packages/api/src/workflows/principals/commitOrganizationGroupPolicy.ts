import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { toMutationError } from "../containers/mutations/errors";
import { OrganizationManagerError } from "../organizations/errors";
import { lockOrganizationGroupMutationInTransaction } from "./principalMutationLock";
import {
  loadRosterSyncTargetForPrincipal,
  type PutPrincipalPolicyInput,
} from "./principalPolicyMutationAuthorization";
import {
  assertPutPrincipalPolicyRouteBinding,
  putPrincipalPolicyInTransaction,
} from "./putPrincipalPolicy";
import { PrincipalPolicyError, toPrincipalPolicyError } from "./shared";

export interface CommitOrganizationGroupPolicyResult {
  readonly policy: CommitOrganizationGroupPolicyResponse;
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
  if (groupInput.state.signerUserId !== organizationInput.state.signerUserId) {
    throw new PrincipalPolicyError(
      "Group and organization policies must have the same signer",
      400,
    );
  }
  assertPutPrincipalPolicyRouteBinding(groupInput);
  assertPutPrincipalPolicyRouteBinding(organizationInput);

  try {
    return await db.transaction(async (tx) => {
      await lockOrganizationGroupMutationInTransaction(
        tx,
        input.organizationId,
        input.groupId,
      );
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
      return {
        policy: {
          groupPolicy: group.policy,
          organizationPolicy: organization.policy,
        },
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
      throw new PrincipalPolicyError(
        containerMutationError.message,
        containerMutationError.status,
      );
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
