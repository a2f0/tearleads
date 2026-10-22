import type { RequestResult } from "@tearleads/api-client";
import {
  type SigningKeyPair,
  signOrganizationLeaveRequest,
} from "@tearleads/crypto";
import type { OrganizationMembershipResponse } from "@tearleads/validators/response";
import type { OrganizationLeaveRequest } from "@tearleads/validators/util";
import type { OrganizationMembership } from "./organizationMemberships";

export interface OrganizationLeaveRequestApi {
  setOrganizationLeaveRequest(
    organizationId: string,
    request: OrganizationLeaveRequest | null,
  ): Promise<RequestResult<OrganizationMembershipResponse>>;
}

export type OrganizationLeaveRequestResult =
  | { readonly status: "updated"; readonly membership: OrganizationMembership }
  | {
      readonly status: "failed";
      readonly httpStatus: number | null;
      readonly message: string;
    };

/**
 * Files or withdraws the user's request to leave one organization. Filing
 * signs the request with the user's identity key, so administrators can tell
 * the member made it; it removes nothing until an administrator approves it.
 */
export async function setOrganizationLeaveRequested(input: {
  readonly apiClient: OrganizationLeaveRequestApi;
  readonly organizationId: string;
  readonly requested: boolean;
  readonly signer: {
    readonly signingKeyPair: Pick<SigningKeyPair, "signingPrivateKey">;
    readonly userId: string;
  };
  readonly now?: () => Date;
}): Promise<OrganizationLeaveRequestResult> {
  const request = input.requested
    ? signOrganizationLeaveRequest(
        {
          organizationId: input.organizationId,
          requestedAt: (input.now?.() ?? new Date()).toISOString(),
          userId: input.signer.userId,
        },
        input.signer.signingKeyPair,
      )
    : null;
  const result = await input.apiClient.setOrganizationLeaveRequest(
    input.organizationId,
    request,
  );
  return result.ok
    ? { membership: result.data, status: "updated" }
    : { httpStatus: result.status, message: result.message, status: "failed" };
}
