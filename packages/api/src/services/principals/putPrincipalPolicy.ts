import {
  type PutPrincipalPolicyInput,
  type PutPrincipalPolicyResult,
  runPutPrincipalPolicyWorkflow,
} from "../../workflows/principals/putPrincipalPolicy";
import type { ApiServiceRuntime } from "../runtime";

export async function putPrincipalPolicy(
  runtime: ApiServiceRuntime,
  input: PutPrincipalPolicyInput,
): Promise<PutPrincipalPolicyResult> {
  return runPutPrincipalPolicyWorkflow(runtime.db, input);
}
