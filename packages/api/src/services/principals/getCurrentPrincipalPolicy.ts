import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { runReadCurrentPrincipalPolicyWorkflow } from "../../workflows/principals/readCurrentPrincipalPolicy";
import type { ApiServiceRuntime } from "../runtime";

/** The bundle a requester is authorized to read; a stranger receives 403. */
export async function getCurrentPrincipalPolicy(
  runtime: ApiServiceRuntime,
  input: {
    readonly principalId: string;
    readonly principalType: "group" | "organization";
    readonly requesterUserId: string;
  },
): Promise<PrincipalPolicyBundleResponse> {
  return runReadCurrentPrincipalPolicyWorkflow(runtime.db, input);
}
