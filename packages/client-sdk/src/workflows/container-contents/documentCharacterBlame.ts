import { base64ToBytes } from "@tearleads/encoding";
import { listSnapshotCharOpIds } from "@tearleads/loro";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import {
  type DocumentCharacterBlameSummary,
  summarizeCharacterBlame,
} from "../../data/documents/editAttribution";

// listSnapshotCharOpIds is O(n²) and runs synchronously on the render thread, so
// cap how much prose it will scan; longer documents surface null blame rather
// than freezing the Info panel when it opens.
const MAX_BLAME_CHARACTER_COUNT = 10_000;

/**
 * Rebuild the document's per-character op ids from the locally persisted snapshot
 * (a shallow snapshot still carries every present character's op id) and resolve
 * them against the attribution segments for per-writer live-character "blame".
 * Returns null when blame can't be produced: no local snapshot, a snapshot too
 * large to scan cheaply, or an unreadable snapshot — blame is supplementary and
 * must never block (or blank) the rest of the Info panel, mirroring the
 * attribution fetch's degrade-to-null.
 */
export function computeCharacterBlame(
  loroSnapshot: string | null,
  segments: DocumentEditAttributionResponse["segments"],
): DocumentCharacterBlameSummary | null {
  if (!loroSnapshot || loroSnapshot.length === 0) {
    return null;
  }
  try {
    const charOpIds = listSnapshotCharOpIds(
      base64ToBytes(loroSnapshot),
      MAX_BLAME_CHARACTER_COUNT,
    );
    return charOpIds === null
      ? null
      : summarizeCharacterBlame(charOpIds, segments);
  } catch {
    return null;
  }
}
