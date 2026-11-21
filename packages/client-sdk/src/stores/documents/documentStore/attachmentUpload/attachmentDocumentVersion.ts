import type { UploadDocumentAttachmentRequest } from "../../../../workflows/blobs";
import type { PendingAttachmentRecord } from "../../../../workflows/documents";

/**
 * Passes in a row that may re-arm the store after the API refused one pending
 * upload's bind because the document advanced. Each honest refusal needs
 * another device to commit inside one pull-then-bind window, so a pass that
 * pulls converges once the document is quiet for that long. Past this many,
 * the store records the stuck upload and waits for a later sync signal, so a
 * server that keeps refusing cannot drive a network-speed loop.
 */
export const MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES = 3;

/**
 * The bind precondition for a pending upload whose slot a sync pass found
 * still asking for its bytes at `checkedVersion`. A store pulls only at the
 * start of a pass, so a refusal ends this attempt instead of refreshing; the
 * next pass pulls, checks the slot again, and binds the completed stage
 * against the newer version.
 */
export function pendingAttachmentDocumentVersion(
  checkedVersion: string,
): UploadDocumentAttachmentRequest["verifiedDocumentVersion"] {
  return async ({ refresh }) => (refresh ? null : checkedVersion);
}

type PendingUpload = Pick<PendingAttachmentRecord, "slotId" | "storageKey">;

/** Refused passes in a row, per pending upload (slot and storage key). */
export type DocumentChangedPasses = ReadonlyMap<string, number>;

type DocumentChangedEvent =
  | {
      /** A pass ended on this upload's bind refused for a newer document. */
      readonly type: "refused";
      readonly upload: PendingUpload;
      readonly pending: readonly PendingUpload[];
    }
  | {
      /** This upload's bind committed. */
      readonly type: "bound";
      readonly upload: PendingUpload;
    };

function pendingUploadKey(upload: PendingUpload): string {
  return JSON.stringify([upload.slotId, upload.storageKey]);
}

/**
 * Each upload has its own budget, so one upload that used it up never makes
 * another's first refusal wait for a later signal. A refusal also forgets
 * uploads that are no longer pending.
 */
function transitionDocumentChangedPasses(
  passes: DocumentChangedPasses,
  event: DocumentChangedEvent,
): DocumentChangedPasses {
  const key = pendingUploadKey(event.upload);
  if (event.type === "bound") {
    return new Map([...passes].filter(([pending]) => pending !== key));
  }
  const pendingKeys = new Set(event.pending.map(pendingUploadKey));
  return new Map([
    ...[...passes].filter(([pending]) => pendingKeys.has(pending)),
    [key, (passes.get(key) ?? 0) + 1],
  ]);
}

interface DocumentChangedPassState {
  attachmentDocumentChangedPasses?: DocumentChangedPasses | undefined;
  readonly pendingAttachments: readonly PendingUpload[];
}

/**
 * Counts a pass that ended on `upload`'s bind refused because the document
 * advanced, and returns whether the store should run another pass to pull
 * right away.
 */
export function recordDocumentChangedRefusal(
  state: DocumentChangedPassState,
  upload: PendingUpload,
): boolean {
  const passes = transitionDocumentChangedPasses(
    state.attachmentDocumentChangedPasses ?? new Map(),
    { pending: state.pendingAttachments, type: "refused", upload },
  );
  state.attachmentDocumentChangedPasses = passes;
  return (
    (passes.get(pendingUploadKey(upload)) ?? 0) <=
    MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES
  );
}

/** A bind that committed ends its upload's run of refused passes. */
export function settleDocumentChangedPasses(
  state: DocumentChangedPassState,
  upload: PendingUpload,
): void {
  if (!state.attachmentDocumentChangedPasses) return;
  state.attachmentDocumentChangedPasses = transitionDocumentChangedPasses(
    state.attachmentDocumentChangedPasses,
    { type: "bound", upload },
  );
}
