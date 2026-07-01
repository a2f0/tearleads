import { deriveStableUuidV4Shaped } from "../../stableUuid";

// A namespace distinct from every other stable-id namespace (e.g. the system
// container namespace) so a document id derived from a local id never collides
// with an id derived from the same string in another domain.
const STABLE_DOCUMENT_ID_NAMESPACE_BYTES = new Uint8Array([
  0x7a, 0x1c, 0x94, 0xe0, 0x5b, 0x63, 0x4e, 0x11, 0x9f, 0x2d, 0xa8, 0x74, 0x36,
  0xc1, 0x0e, 0x52,
]);

/**
 * Derives the remote document id for a local document from its stable `localId`.
 *
 * Deriving (rather than generating a fresh `crypto.randomUUID()` per attempt)
 * makes the first remote create idempotent: if the server commits the create but
 * the response is lost, the retry re-sends the same id and the server reports a
 * conflict the client can adopt, instead of creating a second orphan document.
 */
export function deriveStableDocumentId(localId: string): Promise<string> {
  return deriveStableUuidV4Shaped(STABLE_DOCUMENT_ID_NAMESPACE_BYTES, localId);
}
