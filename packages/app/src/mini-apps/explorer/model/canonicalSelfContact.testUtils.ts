import { deriveStableDocumentId } from "@tearleads/client-sdk";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import { getSelfContactLocalId } from "../../../stores/contacts/selfContact";

// Ready metadata-port fixture, not evidence of persisted alias adoption. Tests
// using real storage should load the identity from that storage instead.
export async function createCanonicalSelfContactIdentity(
  fingerprint: string,
  aliases: ReadonlyArray<string> = [],
): Promise<Extract<SelfContactIdentityView, { status: "ready" }>> {
  const localId = getSelfContactLocalId(fingerprint);
  return {
    status: "ready",
    identity: {
      documentId: await deriveStableDocumentId(localId),
      localId,
      localIds: new Set([localId, ...aliases]),
    },
    isCurrent: () => true,
  };
}
