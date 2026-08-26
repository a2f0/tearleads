import type { LoroDoc } from "loro-crdt";
import {
  encodeVersionVector,
  getImportBlobMetadata,
  listVersionVectorSpans,
  satisfiesVersionVector,
} from "./document";

/**
 * Prove that an update blob contains the document's exact operations for the
 * version-vector range declared by the blob. Range export reproduces Loro's
 * canonical update encoding without letting an already-present operation with
 * the same peer/counter hide conflicting bytes during an import.
 */
export function updateMatchesDocumentHistory(
  doc: LoroDoc,
  update: Uint8Array,
): boolean {
  const metadata = getImportBlobMetadata(update);
  if (
    !satisfiesVersionVector(
      encodeVersionVector(doc),
      metadata.partialEndVersionVector,
    )
  ) {
    return false;
  }

  const updateSpans = listVersionVectorSpans({
    partialEndVersionVector: metadata.partialEndVersionVector,
    partialStartVersionVector: metadata.partialStartVersionVector,
  });
  if (updateSpans.length === 0) return false;
  try {
    const expected = doc.export({
      mode: "updates-in-range",
      spans: updateSpans.map((span) => ({
        id: { counter: span.startCounter, peer: span.peerId },
        len: span.endCounter - span.startCounter,
      })),
    });
    return (
      expected.byteLength === update.byteLength &&
      expected.every((byte, index) => byte === update[index])
    );
  } catch {
    return false;
  }
}
