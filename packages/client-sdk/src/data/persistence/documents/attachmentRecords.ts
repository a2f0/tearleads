import type { AttachmentRemovalMarker } from "../../documents/attachmentRemovalMarkerMachine";
import type { DocumentAttachment } from "../../documents/documentContent";

/**
 * The identity a pending attachment upload reuses across attempts so a retry
 * (next sync pass or after a restart) reproduces byte-identical encrypted bytes
 * and resumes the same multipart stage instead of orphaning it. `contentKey` and
 * the chunk `nonceSeed` are base64. `partSize`/`stageId` are filled in once the
 * multipart stage has been opened and remain null before that.
 */
export interface PendingAttachmentUploadIdentity {
  blobId: string;
  contentKey: string;
  contentKeyEpoch: number;
  nonceSeed: string;
  partSize: number | null;
  plaintextSha256: string;
  stageId: string | null;
}

export interface PendingAttachmentRecord {
  byteLength: number;
  contentSha256: string;
  localId: string;
  mimeType: string | null;
  name: string;
  /**
   * Held bytes staged again for a slot that was bound before: the slot may
   * still have a binding, so the upload lane lists it before binding even
   * under a first-attach storage key.
   */
  requeued?: boolean | undefined;
  slotId: string;
  storageKey: string;
  upload?: PendingAttachmentUploadIdentity | null;
}

export interface LocalAttachmentRecord {
  blobId: string | null;
  byteLength: number;
  // Plaintext digest of the bytes at `storageKey`. Compared with the digest
  // the document content records for the slot: a held copy that differs is a
  // validly signed served binding the document has not recorded (yet).
  contentSha256: string;
  // Set once the slot is unlinked from a synced document and cleared when the
  // slot is written again. The record survives the unlink so the next sync can
  // still detach the remote binding; `detachedAt` is what keeps the local read
  // models from reporting the slot as a live blob reference in the meantime.
  detachedAt: string | null;
  localId: string;
  mimeType: string | null;
  slotId: string;
  storageKey: string;
}

export interface AttachmentStagingRows {
  localAttachments: ReadonlyArray<LocalAttachmentRecord>;
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>;
}

export interface AttachmentRemovalRows {
  mode: "delete" | "detach";
  slotId: string;
  storageKey: string;
}

/** What a removal-marker settle reads in its transaction. */
export interface AttachmentRemovalMarkerObservation {
  /** The slot as committed document history records it, if at all. */
  committed: DocumentAttachment | undefined;
  /** The slot's durable row, whichever copy it names. */
  row: LocalAttachmentRecord | null;
}

/**
 * A settled marker and the slot's rows after it. `write` tells the adapter to
 * upsert `row` (and `pending`), to delete the observed row and queue its bytes
 * for the reference-checked reclaim, or to write nothing.
 */
export interface AttachmentRemovalMarkerSettlement {
  marker: AttachmentRemovalMarker;
  /** The upload a `rebinding` marker queued. */
  pending: PendingAttachmentRecord | null;
  /** The slot's durable row after the settle, whoever wrote it. */
  row: LocalAttachmentRecord | null;
  write: "delete" | "none" | "upsert";
}

/**
 * Settle one removal marker in one immediate transaction: read the slot's row
 * and committed history, apply `settle`, and write its outcome, so a pane's
 * commit of the slot cannot land between the read and the write.
 */
export interface SettleAttachmentRemovalMarkerInput {
  localId: string;
  /** The marker's pure transition over what the transaction read. */
  settle: (
    observed: AttachmentRemovalMarkerObservation,
  ) => AttachmentRemovalMarkerSettlement;
  slotId: string;
  /** Checked immediately before commit; false writes nothing. */
  stillCurrent: () => boolean;
}
