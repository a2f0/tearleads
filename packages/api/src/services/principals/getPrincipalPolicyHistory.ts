import type { PrincipalPolicyHistoryResponse } from "@tearleads/validators/response";
import { runGetPrincipalPolicyHistoryWorkflow } from "../../workflows/principals/getPrincipalPolicyHistory";
import type { ApiServiceRuntime } from "../runtime";

export async function getPrincipalPolicyHistory(
  runtime: ApiServiceRuntime,
  input: {
    readonly beforeVersion: number | null;
    readonly principalId: string;
    readonly principalType: "group" | "organization";
    readonly userId: string;
  },
): Promise<PrincipalPolicyHistoryResponse> {
  return runGetPrincipalPolicyHistoryWorkflow({
    beforeVersion: input.beforeVersion,
    database: runtime.db,
    principalId: input.principalId,
    principalType: input.principalType,
    userId: input.userId,
  });
}
