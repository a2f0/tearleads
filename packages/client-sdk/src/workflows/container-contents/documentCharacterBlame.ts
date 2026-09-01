import { base64ToBytes } from "@tearleads/encoding";
import { listSnapshotCharBlameSource } from "@tearleads/loro";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import {
  type DocumentBlameRange,
  type DocumentCharacterBlameSummary,
  summarizeDocumentBlame,
} from "../../data/documents/editAttribution";

// Op-id extraction is linear (~1.8µs/char — ~90ms for a 50k snapshot, flat per
// char), so this cap is a soft guard against pathologically large prose, not a
// quadratic cliff: above it blame surfaces null rather than doing unbounded
// synchronous work when the Info panel opens.
const MAX_BLAME_CHARACTER_COUNT = 50_000;

/**
 * Rebuild the document's per-character op ids from the locally persisted
 * content snapshot and resolve them against the attribution segments — in a
 * single snapshot reconstruction — into both the per-writer blame summary and
 * the coalesced per-writer ranges. Returns null when blame can't be produced:
 * no local snapshot, a snapshot too large to scan cheaply, or an unreadable
 * snapshot — blame is supplementary and must never block (or blank) the rest
 * of the Info panel, mirroring the attribution fetch's degrade-to-null.
 */
export function computeDocumentBlame(
  contentSnapshot: string | null,
  segments: DocumentEditAttributionResponse["segments"],
): {
  /** Per-writer live-character counts (the Contributors-style rollup). */
  characterBlame: DocumentCharacterBlameSummary;
  /** Contiguous per-writer runs of the current prose (the read-only blame view). */
  blameRanges: DocumentBlameRange[];
} | null {
  if (!contentSnapshot || contentSnapshot.length === 0) {
    return null;
  }
  try {
    const source = listSnapshotCharBlameSource(
      base64ToBytes(contentSnapshot),
      MAX_BLAME_CHARACTER_COUNT,
    );
    if (source === null) {
      return null;
    }
    return summarizeDocumentBlame(source, segments);
  } catch {
    return null;
  }
}
