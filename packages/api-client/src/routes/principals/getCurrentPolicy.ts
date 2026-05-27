import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function getCurrentPrincipalPolicy(
  request: RequestFn,
  principalType: "group" | "organization",
  principalId: string,
) {
  return request(
    `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/policy`,
    isPrincipalPolicyBundleResponse,
    "GET",
  );
}
