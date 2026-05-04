import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { runGetCurrentPrincipalPolicyWorkflow } from "../../workflows/principals/getCurrentPrincipalPolicy";
import type { ApiServiceRuntime } from "../runtime";

export async function getCurrentPrincipalPolicy(
  runtime: ApiServiceRuntime,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  return runGetCurrentPrincipalPolicyWorkflow(
    runtime.db,
    principalType,
    principalId,
  );
}
