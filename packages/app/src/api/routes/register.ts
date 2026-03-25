import { isPublicKeyRequest } from "@tearleads/validators/request";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import { request } from "../util/request";

export function postPublicKey(
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
