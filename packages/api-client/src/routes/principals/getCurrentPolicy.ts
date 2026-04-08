import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getCurrentPrincipalPolicy(
  request: RequestFn,
  principalType: "group" | "organization",
  principalId: string,
) {
  return request(
    `/principals/${principalType}/${principalId}/policy`,
    isPrincipalPolicyBundleResponse,
    "GET",
  );
}
