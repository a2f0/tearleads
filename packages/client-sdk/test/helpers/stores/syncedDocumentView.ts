import { encodeVersionVector } from "@tearleads/loro";
import { getDocumentAttachments } from "../../../src/data/documents/documentContent";
import type { DocumentState } from "../../../src/stores/documents/documentStore/state";
import type { SyncedDocumentView } from "../../../src/stores/documents/documentStore/sync/syncedDocumentView";

/**
 * The live document as a detach pass cites it, for tests that run the pass
 * directly rather than at the end of a sync pass that checked it is synced.
 */
export function liveDocumentView(
  doc: DocumentState | null,
): SyncedDocumentView {
  if (!doc) throw new Error("Expected a loaded document");
  return {
    slotIds: new Set(
      getDocumentAttachments(doc).map((attachment) => attachment.slotId),
    ),
    versionVector: encodeVersionVector(doc),
  };
}
