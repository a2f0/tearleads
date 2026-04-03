import type { RecipientEntry } from "@tearleads/crypto";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../types";

export function postPublicKey(
  request: RequestFn,
  containerId: string,
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  wrappedDekEnvelope: RecipientEntry,
) {
  return request(
    "/auth/register",
    isPublicKeyResponse,
    "POST",
    JSON.stringify({
      containerId,
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      wrappedDekEnvelope: {
        keyFingerprint: wrappedDekEnvelope.keyFingerprint,
        kemCipherText: Array.from(wrappedDekEnvelope.kemCipherText),
        wrappedKey: Array.from(wrappedDekEnvelope.wrappedKey),
      },
    }),
  );
}
