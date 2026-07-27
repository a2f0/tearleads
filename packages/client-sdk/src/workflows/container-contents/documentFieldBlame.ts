import { base64ToBytes } from "@tearleads/encoding";
import { listSnapshotFieldEditors } from "@tearleads/loro";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { DOCUMENT_FIELDS_MAP_KEY } from "../../data/documents/documentKinds";
import {
  type DocumentFieldBlame,
  summarizeFieldBlame,
} from "../../data/documents/editAttribution";

/**
 * Per-field "blame" for a structured document: read the peer that last set each
 * field from the locally persisted snapshot and resolve it against the
 * attribution segments. Reconstructing the small `fields` map is cheap (no
 * per-character sweep), so this runs its own reconstruction independent of the
 * character-blame path. Returns null when it can't be produced — no local
 * snapshot or an unreadable one — mirroring the character-blame degrade-to-null;
 * a note (or any document without fields) yields an empty array, not null.
 */
export function computeFieldBlame(
  contentSnapshot: string | null,
  segments: DocumentEditAttributionResponse["segments"],
): DocumentFieldBlame[] | null {
  if (!contentSnapshot || contentSnapshot.length === 0) {
    return null;
  }
  try {
    const fieldEditors = listSnapshotFieldEditors(
      base64ToBytes(contentSnapshot),
      DOCUMENT_FIELDS_MAP_KEY,
    );
    return summarizeFieldBlame(fieldEditors, segments);
  } catch {
    return null;
  }
}
