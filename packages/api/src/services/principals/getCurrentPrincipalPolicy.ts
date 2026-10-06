import type { PrincipalPolicyPageQuery } from "@tearleads/validators/operation";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { runReadCurrentPrincipalPolicyWorkflow } from "../../workflows/principals/readCurrentPrincipalPolicy";
import type { ApiServiceRuntime } from "../runtime";

/** A pinned policy page with current read authorization; strangers receive 403. */
export async function getCurrentPrincipalPolicy(
  runtime: ApiServiceRuntime,
  input: PrincipalPolicyPageQuery & {
    readonly principalId: string;
    readonly principalType: "group" | "organization";
    readonly requesterUserId: string;
  },
): Promise<PrincipalPolicyPageResponse> {
  return runReadCurrentPrincipalPolicyWorkflow(runtime.db, input);
}
