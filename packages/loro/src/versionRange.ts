import { type LoroDoc, type PeerID, VersionVector } from "loro-crdt";
import {
  decodeVersionVector,
  encodeEncodedVersionVector,
  encodeVersionVector,
  satisfiesVersionVector,
} from "./document";

export interface OperationSpan {
  id: { counter: number; peer: PeerID };
  len: number;
}

/**
 * Per-peer `[start, end)` operation spans between two version vectors, or
 * null when any peer's start exceeds its end.
 */
export function operationSpans(
  startVersion: VersionVector,
  endVersion: VersionVector,
): OperationSpan[] | null {
  for (const [peer, startCounter] of startVersion.toJSON()) {
    if (startCounter > (endVersion.get(peer) ?? 0)) return null;
  }
  return [...endVersion.toJSON()].flatMap(([peer, endCounter]) => {
    const startCounter = startVersion.get(peer) ?? 0;
    return endCounter === startCounter
      ? []
      : [
          {
            id: { counter: startCounter, peer },
            len: endCounter - startCounter,
          },
        ];
  });
}

/**
 * Per-peer minimum across version vectors: each peer that appears in any
 * vector keeps its smallest counter. The union start of several partial
 * update ranges.
 */
export function minimumVersionVectors(
  encodedVersionVectors: ReadonlyArray<string>,
): string {
  const minimum = new Map<PeerID, number>();
  for (const encodedVersionVector of encodedVersionVectors) {
    for (const [peer, counter] of decodeVersionVector(
      encodedVersionVector,
    ).toJSON()) {
      const current = minimum.get(peer);
      minimum.set(
        peer,
        current === undefined ? counter : Math.min(current, counter),
      );
    }
  }
  return encodeEncodedVersionVector(VersionVector.parseJSON(minimum));
}

/**
 * Export exactly the document's operations in the per-peer spans
 * `[start, end)` as one `updates-in-range` blob. Returns null when the
 * document does not cover `end`, any peer's start exceeds its end, or the
 * range holds no operations. Operations outside the spans (other peers'
 * history, interleaved remote ops) are never included.
 */
export function exportUpdatesInVersionRange(
  doc: LoroDoc,
  partialStartVersionVector: string,
  partialEndVersionVector: string,
): Uint8Array | null {
  if (
    !satisfiesVersionVector(encodeVersionVector(doc), partialEndVersionVector)
  ) {
    return null;
  }
  const spans = operationSpans(
    decodeVersionVector(partialStartVersionVector),
    decodeVersionVector(partialEndVersionVector),
  );
  if (!spans || spans.length === 0) return null;
  return doc.export({ mode: "updates-in-range", spans });
}
