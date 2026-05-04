import type { CurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import {
  type PutPrincipalMemberEnvelopesInput,
  runPutPrincipalMemberEnvelopesWorkflow,
} from "../../workflows/principals/putPrincipalMemberEnvelopes";
import type { ApiServiceRuntime } from "../runtime";

export async function putPrincipalMemberEnvelopes(
  runtime: ApiServiceRuntime,
  input: PutPrincipalMemberEnvelopesInput,
): Promise<CurrentPrincipalMemberEnvelopesResponse> {
  return runPutPrincipalMemberEnvelopesWorkflow(runtime.db, input);
}
