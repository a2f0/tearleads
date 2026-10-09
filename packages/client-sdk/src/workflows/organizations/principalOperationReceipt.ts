import { computePrincipalStateHash } from "@tearleads/crypto";
import {
  type CommitOrganizationGroupPolicyResponse,
  type CreateOrganizationGroupResponse,
  type DeleteOrganizationGroupResponse,
  isCommitOrganizationGroupPolicyResponse,
  isCreateOrganizationGroupResponse,
  isDeleteOrganizationGroupResponse,
  isPrincipalPolicyMutationResponse,
  type PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import type { AuthoredPrincipalMutation } from "../../data/principals/principalMutationJournal";
import { acknowledgeInitialGroupPolicy } from "./groupPolicyMutationAcknowledgement";
import {
  assertAuthoredPrincipalMutationReceipt,
  assertAuthoredPrincipalPolicyReceipt,
} from "./principalMutationReceipt";

export type PrincipalMutationResponse =
  | CommitOrganizationGroupPolicyResponse
  | CreateOrganizationGroupResponse
  | DeleteOrganizationGroupResponse
  | PrincipalPolicyMutationResponse;

/** Match both the operation's route and its exact authored policy artifacts. */
export async function assertAuthoredPrincipalOperationReceipt(
  mutation: AuthoredPrincipalMutation,
  response: PrincipalMutationResponse,
): Promise<void> {
  switch (mutation.kind) {
    case "compound":
      if (!isCommitOrganizationGroupPolicyResponse(response)) break;
      return assertAuthoredPrincipalMutationReceipt(mutation.request, response);
    case "organization":
      if (!isPrincipalPolicyMutationResponse(response)) break;
      return assertAuthoredPrincipalPolicyReceipt(mutation.request, response);
    case "group-create":
      if (!isCreateOrganizationGroupResponse(response)) break;
      await acknowledgeInitialGroupPolicy({
        organizationId: mutation.request.organizationPolicy.state.principalId,
        request: mutation.request,
        response: response.group,
        stateHash: await computePrincipalStateHash(
          mutation.request.initialGroupPolicy.state,
        ),
      });
      return assertAuthoredPrincipalPolicyReceipt(
        mutation.request.organizationPolicy,
        response.organizationPolicy,
      );
    case "group-delete":
      if (
        !isDeleteOrganizationGroupResponse(response) ||
        response.groupId !== mutation.groupId ||
        response.organizationId !==
          mutation.request.organizationPolicy.state.principalId
      )
        break;
      return assertAuthoredPrincipalPolicyReceipt(
        mutation.request.organizationPolicy,
        response.organizationPolicy,
      );
  }
  throw new Error("Principal mutation receipt operation or target differs");
}
