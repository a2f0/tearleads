import { isVerifyRequest } from "@tearleads/validators/request";
import type { VerifyResponse } from "@tearleads/validators/response";
import { request } from "../../util/request";

export function postVerify(fingerprint: string, signature: Uint8Array) {
  const body = {
    fingerprint,
    signature: Array.from(signature),
  };
  if (!isVerifyRequest(body)) {
    throw new Error("Invalid VerifyRequest");
  }
  return request<VerifyResponse>("/auth/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
