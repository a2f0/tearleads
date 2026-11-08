import type { PrincipalMemberEnvelopesQuery } from "@tearleads/validators/operation";
import type { CurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import { runReadPrincipalMemberEnvelopesWorkflow } from "../../workflows/principals/readPrincipalMemberEnvelopes";
import type { ApiServiceRuntime } from "../runtime";

/**
 * The member envelopes of one named state of a principal, to the policy read's
 * callers; strangers receive 403 and a state the principal never had 404.
 */
export async function getPrincipalMemberEnvelopes(
  runtime: ApiServiceRuntime,
  input: PrincipalMemberEnvelopesQuery & {
    readonly principalId: string;
    readonly principalType: "group" | "organization";
    readonly requesterUserId: string;
  },
): Promise<CurrentPrincipalMemberEnvelopesResponse> {
  return runReadPrincipalMemberEnvelopesWorkflow(runtime.db, input);
}
