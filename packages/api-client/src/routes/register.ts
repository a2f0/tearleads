import { isPublicKeyResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../types";

export function postPublicKey(
  request: RequestFn,
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
) {
  return request(
    "/auth/register",
    isPublicKeyResponse,
    "POST",
    JSON.stringify({
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
    }),
  );
}
