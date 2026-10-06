import type { ProjectionPolicyHistoryQuery } from "@tearleads/validators/operation";
import { runReadProjectionPolicyHistoryWorkflow } from "../../workflows/principals/readProjectionPolicyHistory";
import type { ApiServiceRuntime } from "../runtime";

export function getProjectionPolicyHistory(
  runtime: ApiServiceRuntime,
  input: ProjectionPolicyHistoryQuery & { readonly requesterUserId: string },
) {
  return runReadProjectionPolicyHistoryWorkflow(runtime.db, input);
}
