import { runGetOrganizationPolicyHistoryWorkflow } from "../../workflows/organizations/policyHistory";
import type { ApiServiceRuntime } from "../runtime";

export function getOrganizationPolicyHistory(
  runtime: ApiServiceRuntime,
  input: { organizationId: string; requesterUserId: string; stateHash: string },
) {
  return runGetOrganizationPolicyHistoryWorkflow(runtime.db, input);
}
