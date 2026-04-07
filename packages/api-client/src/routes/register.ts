import type { RecipientEntry } from "@tearleads/crypto";
import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import type { RequestFn } from "../types";

export function postPublicKey(
  request: RequestFn,
  rootContainerId: string,
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  wrappedDekEnvelope: RecipientEntry,
  initialRootMetadataUpdates: SyncDocumentOutgoingUpdate[],
  initialRootMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[],
) {
  return request(
    "/auth/register",
    isPublicKeyResponse,
    "POST",
    JSON.stringify({
      rootContainerId,
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      initialRootMetadataRecipientEnvelopes,
      initialRootMetadataUpdates,
      wrappedDekEnvelope: {
        keyFingerprint: wrappedDekEnvelope.keyFingerprint,
        kemCipherText: Array.from(wrappedDekEnvelope.kemCipherText),
        wrappedKey: Array.from(wrappedDekEnvelope.wrappedKey),
      },
    }),
  );
}
