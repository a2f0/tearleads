import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { acknowledgedPrincipalPolicyCurrent } from "../principalPolicy/principalPolicyReceiptArtifacts";

/** A past commit acknowledgement is not evidence for advancing current pins. */
export async function assertAuthoredPrincipalMutationReceipt(
  request: CommitOrganizationGroupPolicyRequest,
  response: CommitOrganizationGroupPolicyResponse,
): Promise<void> {
  for (const part of ["groupPolicy", "organizationPolicy"] as const) {
    await acknowledgedPrincipalPolicyCurrent({
      request: request[part],
      response: response[part],
    });
  }
  if (Boolean(request.memberPolicy) !== Boolean(response.memberPolicy)) {
    throw new Error("Principal mutation receipt Members policy differs");
  }
  if (request.memberPolicy && response.memberPolicy) {
    await acknowledgedPrincipalPolicyCurrent({
      request: request.memberPolicy,
      response: response.memberPolicy,
    });
  }
}
