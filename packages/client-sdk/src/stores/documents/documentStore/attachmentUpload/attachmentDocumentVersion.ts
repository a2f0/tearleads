import type { UploadDocumentAttachmentRequest } from "../../../../workflows/blobs";
import type { PendingAttachmentRecord } from "../../../../workflows/documents";

/**
 * Store passes in a row that may end on one pending upload's bind refused
 * because the document advanced and still re-arm right away. Inside a pass
 * each refusal already pulled and checked the slot again (up to the upload
 * call's own limit), so a pass ends this way only while another device keeps
 * committing inside every pull-then-bind window. Past this many, the store
 * records the stuck upload and waits for a later sync signal, so a server
 * that keeps refusing cannot drive a network-speed loop.
 */
export const MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES = 3;

/**
 * The bind precondition for a pending upload whose slot a sync pass found
 * still asking for its bytes at `checkedVersion`. After the API refuses a
 * bind because the document advanced, the same pass pulls, checks the slot
 * again, and returns the version that check read, so the completed stage
 * binds without waiting for another pass. Null abandons this attempt: the
 * pull did not complete, or the slot no longer asks for the bytes.
 */
export function pendingAttachmentDocumentVersion(input: {
  readonly checkedVersion: string;
  /** The slot check after a pull, read in one step with its version. */
  readonly matchingVersion: () => string | null;
  /** Pulls the document within this pass; false when the pull is incomplete. */
  readonly pull: () => Promise<boolean>;
}): UploadDocumentAttachmentRequest["verifiedDocumentVersion"] {
  return async ({ refresh }) => {
    if (!refresh) return input.checkedVersion;
    return (await input.pull()) ? input.matchingVersion() : null;
  };
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
      /** This upload's attempt bound, or ended for another reason. */
      readonly type: "settled";
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
  if (event.type === "settled") {
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

/**
 * An attempt that bound, or ended other than refused for a newer document,
 * ends its upload's run of refused passes.
 */
export function settleDocumentChangedPasses(
  state: DocumentChangedPassState,
  upload: PendingUpload,
): void {
  if (!state.attachmentDocumentChangedPasses) return;
  state.attachmentDocumentChangedPasses = transitionDocumentChangedPasses(
    state.attachmentDocumentChangedPasses,
    { type: "settled", upload },
  );
}
