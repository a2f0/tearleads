import { encodeVersionVector, satisfiesVersionVector } from "@tearleads/loro";
import { listRecordedAttachmentSlotIds } from "../../../../data/documents/documentContent";
import type { DocumentState, DocumentStoreState } from "../state";

/** A version of the document holding only ops the server has, read in one step. */
export interface SyncedDocumentView {
  /** The slots this version holds an entry for, whether or not it parses. */
  readonly slotIds: ReadonlySet<string>;
  readonly versionVector: string;
}

/**
 * The live document as a detach may cite it, or null while it holds an edit
 * not yet durably enqueued. Read it before the pass lists pending updates:
 * when none remain after that, every op this version holds was pushed or
 * pulled. A detach must never rest on an unsent op, such as a removal that
 * may yet roll back or never reach the server.
 */
export function captureSyncedDocumentView(
  state: DocumentStoreState,
  doc: DocumentState,
): SyncedDocumentView | null {
  if (state.pendingLocalWrites > 0 || state.pendingBaseVersion === null) {
    return null;
  }
  const versionVector = encodeVersionVector(doc);
  if (!satisfiesVersionVector(state.pendingBaseVersion, versionVector)) {
    return null;
  }
  return {
    slotIds: new Set(listRecordedAttachmentSlotIds(doc)),
    versionVector,
  };
}
