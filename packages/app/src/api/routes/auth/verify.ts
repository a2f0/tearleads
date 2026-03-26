import { isVerifyRequest } from "@tearleads/validators/request";
import { isVerifyResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function postVerify(
  request: RequestFn,
  fingerprint: string,
  signature: Uint8Array,
) {
  const body = {
    fingerprint,
    signature: Array.from(signature),
  };
  if (!isVerifyRequest(body)) {
    throw new Error("Invalid VerifyRequest");
  }
  return request(
    "/auth/verify",
    isVerifyResponse,
    "POST",
    JSON.stringify(body),
  );
}
