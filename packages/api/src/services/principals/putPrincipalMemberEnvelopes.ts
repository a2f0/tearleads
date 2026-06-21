import type { CurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import {
  type PutPrincipalMemberEnvelopesInput,
  runPutPrincipalMemberEnvelopesWorkflow,
} from "../../workflows/principals/putPrincipalMemberEnvelopes";
import type { ApiServiceRuntime } from "../runtime";

// `input` carries the authenticated `requesterUserId` (set by the route from the
// session) so the workflow can enforce that only a member of the target
// principal may rewrite its member key envelopes.
export async function putPrincipalMemberEnvelopes(
  runtime: ApiServiceRuntime,
  input: PutPrincipalMemberEnvelopesInput,
): Promise<CurrentPrincipalMemberEnvelopesResponse> {
  return runPutPrincipalMemberEnvelopesWorkflow(runtime.db, input);
}
