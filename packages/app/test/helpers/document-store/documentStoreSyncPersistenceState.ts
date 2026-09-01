import type {
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
} from "@tearleads/client-sdk";

type AttachmentRemovalRows = NonNullable<
  Parameters<
    DocumentsPersistence["commitDocumentMutation"]
  >[1]["attachmentRemoval"]
>;
type DocumentHistoryRestoreState = Awaited<
  ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>
>;

export interface StoredHistoryState {
  checkpoint: { endVersionVector: string; snapshot: string } | null;
  tail: { id: string; origin: "local" | "remote"; updateData: string }[];
}

export function toHistoryRestoreState(
  history: StoredHistoryState | undefined,
): DocumentHistoryRestoreState | null {
  // Mirror SQL: a tail without a checkpoint restores from an empty snapshot
  // rather than silently dropping queued local history.
  if (!history || (!history.checkpoint && history.tail.length === 0)) {
    return null;
  }
  return {
    snapshot: history.checkpoint?.snapshot ?? "",
    tailUpdates: history.tail.map((entry) => ({
      origin: entry.origin,
      updateData: entry.updateData,
    })),
  };
}

export function applyMemoryAttachmentRemoval(input: {
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
  removal: AttachmentRemovalRows;
}): {
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
} {
  const matches = (attachment: { slotId: string; storageKey: string }) =>
    attachment.slotId === input.removal.slotId &&
    attachment.storageKey === input.removal.storageKey;
  return {
    pendingAttachments: input.pendingAttachments.filter(
      (attachment) => !matches(attachment),
    ),
    localAttachments:
      input.removal.mode === "detach"
        ? input.localAttachments.map((attachment) =>
            matches(attachment)
              ? {
                  ...attachment,
                  detachedAt: "2026-04-06T00:00:00.000Z",
                }
              : attachment,
          )
        : input.localAttachments.filter((attachment) => !matches(attachment)),
  };
}
