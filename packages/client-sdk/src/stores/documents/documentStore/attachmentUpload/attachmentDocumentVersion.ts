import { encodeVersionVector } from "@tearleads/loro";
import type { UploadDocumentAttachmentRequest } from "../../../../workflows/blobs";
import type { DocumentState, DocumentStoreState } from "../state";

/**
 * Passes in a row that may re-arm the store after the API refused a pending
 * upload's bind because the document advanced. Each honest refusal needs
 * another device to commit inside one pull-then-bind window, so a pass that
 * pulls converges once the document is quiet for that long. Past this many,
 * the store records the stuck upload and waits for a later sync signal, so a
 * server that keeps refusing cannot drive a network-speed loop.
 */
export const MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES = 3;

/**
 * The document version at which a sync pass checked that a pending upload's
 * slot still asks for its bytes, for the bind's precondition. A store pulls
 * only at the start of a pass, so when the API refuses the bind for a newer
 * document this attempt ends; the next pass pulls, checks the slot again,
 * and binds the completed stage against the newer version.
 */
export interface PendingAttachmentDocumentVersion {
  /** Whether the API refused a bind because the document advanced. */
  readonly documentChanged: () => boolean;
  readonly verifiedDocumentVersion: UploadDocumentAttachmentRequest["verifiedDocumentVersion"];
}

/** Call right after the pass confirms the pending upload matches its slot. */
export function capturePendingAttachmentDocumentVersion(
  checkedDoc: DocumentState,
): PendingAttachmentDocumentVersion {
  const checkedVersion = encodeVersionVector(checkedDoc);
  let documentChanged = false;
  return {
    documentChanged: () => documentChanged,
    verifiedDocumentVersion: async ({ refresh }) => {
      if (!refresh) return checkedVersion;
      documentChanged = true;
      return null;
    },
  };
}

/**
 * Counts a pass that ended on a bind refused because the document advanced,
 * and returns whether the store should run another pass to pull right away.
 */
export function shouldRepullAfterDocumentChanged(
  state: DocumentStoreState,
): boolean {
  const passes = state.attachmentDocumentChangedPasses ?? 0;
  state.attachmentDocumentChangedPasses = passes + 1;
  return passes < MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES;
}

/** A bind that committed ends the run of refused passes. */
export function settleDocumentChangedPasses(state: DocumentStoreState): void {
  state.attachmentDocumentChangedPasses = 0;
}
