import { wrapDekForRecipients } from "@tearleads/crypto";
import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import { routeApp } from "../../../src/routeApp";

export async function uploadKey(
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  initialRootMetadataUpdates: SyncDocumentOutgoingUpdate[] = [],
): Promise<Response> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const recipients = await wrapDekForRecipients(dek, [encapsulationPublicKey]);
  const wrappedEnvelope = recipients[0];

  if (!wrappedEnvelope) {
    throw new Error("Failed to wrap DEK for test user");
  }

  return routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rootContainerId: crypto.randomUUID(),
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      initialRootMetadataUpdates,
      wrappedDekEnvelope: {
        keyFingerprint: wrappedEnvelope.keyFingerprint,
        kemCipherText: Array.from(wrappedEnvelope.kemCipherText),
        wrappedKey: Array.from(wrappedEnvelope.wrappedKey),
      },
    }),
  });
}
