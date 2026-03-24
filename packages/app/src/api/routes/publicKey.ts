import type { PublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { request } from "../util/request";

export function postPublicKey(publicKey: Uint8Array) {
  const body: PublicKeyRequest = { publicKey: Array.from(publicKey) };
  return request<PublicKeyResponse>("/publicKey", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
