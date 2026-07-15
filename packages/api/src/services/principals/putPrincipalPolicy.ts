import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  type PutPrincipalPolicyInput,
  runPutPrincipalPolicyWorkflow,
} from "../../workflows/principals/putPrincipalPolicy";
import type { ApiServiceRuntime } from "../runtime";

export async function putPrincipalPolicy(
  runtime: ApiServiceRuntime,
  input: PutPrincipalPolicyInput,
): Promise<PrincipalPolicyBundleResponse> {
  return runPutPrincipalPolicyWorkflow(runtime.db, input);
}
