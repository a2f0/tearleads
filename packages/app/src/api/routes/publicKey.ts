import { isPublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { request } from "../util/request";

export function postPublicKey(publicKey: Uint8Array) {
  const body = { publicKey: Array.from(publicKey) };
  if (!isPublicKeyRequest(body)) {
    throw new Error("Invalid PublicKeyRequest");
  }
  return request<PublicKeyResponse>("/publicKey", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
