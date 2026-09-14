import type { DocumentAttachment } from "../../../data/documents/documentContent";
import type { DocumentAttachmentStatus } from "../types";

export function getAttachmentStorageKeys(
  storageKeyBySlotId: Readonly<Record<string, string>>,
  attachments: ReadonlyArray<DocumentAttachment>,
): Record<string, string> {
  const nextStorageKeys: Record<string, string> = {};

  for (const attachment of attachments) {
    const storageKey = storageKeyBySlotId[attachment.slotId];
    if (storageKey) {
      nextStorageKeys[attachment.slotId] = storageKey;
    }
  }

  return nextStorageKeys;
}

/**
 * A slot is `syncing` while its upload is queued. Otherwise it is
 * `intent-mismatch` when the held bytes' digest differs from the digest the
 * document content records: a validly signed served binding the document has
 * not (yet) recorded. The status clears by itself once the content update
 * carrying the digest arrives or a matching binding is hydrated.
 */
export function getAttachmentStatuses(input: {
  attachments: ReadonlyArray<DocumentAttachment>;
  contentSha256BySlotId: Readonly<Record<string, string>>;
  pendingSlotIds: ReadonlySet<string>;
}): Record<string, DocumentAttachmentStatus> {
  const nextStatuses: Record<string, DocumentAttachmentStatus> = {};

  for (const attachment of input.attachments) {
    if (input.pendingSlotIds.has(attachment.slotId)) {
      nextStatuses[attachment.slotId] = "syncing";
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
