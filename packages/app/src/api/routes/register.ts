import { isPublicKeyRequest } from "@tearleads/validators/request";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../types";

export function postPublicKey(
  request: RequestFn,
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
) {
  const body = {
    signingPublicKey: Array.from(signingPublicKey),
    encapsulationPublicKey: Array.from(encapsulationPublicKey),
  };
  if (!isPublicKeyRequest(body)) {
    throw new Error("Invalid PublicKeyRequest");
  }
  return request(
    "/auth/register",
    isPublicKeyResponse,
    "POST",
    JSON.stringify(body),
  );
}
