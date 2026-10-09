import type { DocumentsPersistence } from "@tearleads/client-sdk";

type AttachmentState = {
  localAttachments: readonly { storageKey: string }[];
  pendingAttachments: readonly { storageKey: string }[];
};

/** The fixture's queue and reference lookup share its in-memory rows. */
export function withMemoryOrphanBlobReclaims<T extends AttachmentState>(
  persistence: Omit<DocumentsPersistence, "orphanBlobs"> & {
    getState: () => T;
  },
): DocumentsPersistence & { getState: () => T } {
  const queued = new Set<string>();
  return {
    ...persistence,
    orphanBlobs: {
      acknowledge: async (_execSql, storageKey) => {
        queued.delete(storageKey);
      },
      isReferenced: async (_execSql, storageKey) => {
        const state = persistence.getState();
        return [...state.localAttachments, ...state.pendingAttachments].some(
          (row) => row.storageKey === storageKey,
        );
      },
      list: async (_execSql, limit) => [...queued].slice(0, limit),
      sweep: async () => false,
    },
    async commitDocumentMutation(execSql, input, saveClientProjection) {
      const result = await persistence.commitDocumentMutation(
        execSql,
        input,
        saveClientProjection,
      );
      if (result.committed && input.attachmentRemoval?.mode === "delete") {
        queued.add(input.attachmentRemoval.storageKey);
      }
      return result;
    },
    async deleteLocalAttachment(execSql, localId, slotId, storageKey) {
      await persistence.deleteLocalAttachment(
        execSql,
        localId,
        slotId,
        storageKey,
      );
      queued.add(storageKey);
    },
  };
}
