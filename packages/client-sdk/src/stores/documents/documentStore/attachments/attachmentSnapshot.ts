import type { DocumentAttachment } from "../../../../data/documents/documentContent";
import type { DocumentAttachmentStatus, DocumentSnapshot } from "../../types";
import {
  type HeldCopySlots,
  unavailableHeldCopySlotIds,
} from "./heldCopyChecks";

/** The snapshot's per-slot status and the storage keys a reader may open. */
export function getAttachmentSlotSnapshot(
  state: HeldCopySlots & {
    readonly pendingAttachments: ReadonlyArray<{ readonly slotId: string }>;
  },
  attachments: ReadonlyArray<DocumentAttachment>,
): Pick<
  DocumentSnapshot,
  "attachmentStatusBySlotId" | "attachmentStorageKeyBySlotId"
> {
  const unavailableSlotIds = unavailableHeldCopySlotIds(state);
  return {
    attachmentStatusBySlotId: getAttachmentStatuses({
      attachments,
      contentSha256BySlotId: state.attachmentContentSha256BySlotId,
      pendingSlotIds: new Set(
        state.pendingAttachments.map((attachment) => attachment.slotId),
      ),
      unavailableSlotIds,
    }),
    attachmentStorageKeyBySlotId: getAttachmentStorageKeys(
      state.attachmentStorageKeyBySlotId,
      attachments,
      unavailableSlotIds,
    ),
  };
}

// An unavailable copy's key is withheld: its file is missing or damaged.
function getAttachmentStorageKeys(
  storageKeyBySlotId: Readonly<Record<string, string>>,
  attachments: ReadonlyArray<DocumentAttachment>,
  unavailableSlotIds: ReadonlySet<string>,
): Record<string, string> {
  const nextStorageKeys: Record<string, string> = {};

  for (const attachment of attachments) {
    const storageKey = storageKeyBySlotId[attachment.slotId];
    if (storageKey && !unavailableSlotIds.has(attachment.slotId)) {
      nextStorageKeys[attachment.slotId] = storageKey;
    }
  }

  return nextStorageKeys;
}

/**
 * A slot is `syncing` while its upload is queued, and `unavailable` when a
 * check found its held file missing or damaged. Otherwise it is
 * `intent-mismatch` when the held bytes' digest differs from the digest the
 * document content records: a validly signed served binding the document has
 * not (yet) recorded. The status clears by itself once the content update
 * carrying the digest arrives or a matching binding is hydrated.
 */
export function getAttachmentStatuses(input: {
  attachments: ReadonlyArray<DocumentAttachment>;
  contentSha256BySlotId: Readonly<Record<string, string>>;
  pendingSlotIds: ReadonlySet<string>;
  unavailableSlotIds: ReadonlySet<string>;
}): Record<string, DocumentAttachmentStatus> {
  const nextStatuses: Record<string, DocumentAttachmentStatus> = {};

  for (const attachment of input.attachments) {
    if (input.pendingSlotIds.has(attachment.slotId)) {
      nextStatuses[attachment.slotId] = "syncing";
      continue;
    }
    if (input.unavailableSlotIds.has(attachment.slotId)) {
      nextStatuses[attachment.slotId] = "unavailable";
      continue;
    }
    const heldContentSha256 = input.contentSha256BySlotId[attachment.slotId];
    if (
      heldContentSha256 !== undefined &&
      heldContentSha256 !== attachment.contentSha256
    ) {
      nextStatuses[attachment.slotId] = "intent-mismatch";
    }
  }

  return nextStatuses;
}
