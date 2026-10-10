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
  const referenceCounts = () => {
    const state = persistence.getState();
    const counts = new Map<string, number>();
    for (const row of [
      ...state.localAttachments,
      ...state.pendingAttachments,
    ]) {
      counts.set(row.storageKey, (counts.get(row.storageKey) ?? 0) + 1);
    }
    return counts;
  };
  function queueRemovedCopies<Args extends unknown[], Result>(
    mutate: (...args: Args) => Promise<Result>,
  ) {
    return async (...args: Args): Promise<Result> => {
      const before = referenceCounts();
      const result = await mutate(...args);
      const after = referenceCounts();
      for (const [key, count] of before) {
        if ((after.get(key) ?? 0) < count) queued.add(key);
      }
      return result;
    };
  }
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
    commitDocumentMutation: queueRemovedCopies(
      persistence.commitDocumentMutation,
    ),
    deleteDocument: queueRemovedCopies(persistence.deleteDocument),
    deleteDocumentIfMatches: queueRemovedCopies(
      persistence.deleteDocumentIfMatches,
    ),
    deleteDocumentSideRowsIfAbsent: queueRemovedCopies(
      persistence.deleteDocumentSideRowsIfAbsent,
    ),
    deleteLocalAttachment: queueRemovedCopies(
      persistence.deleteLocalAttachment,
    ),
    saveHydratedAttachment: async (execSql, input) => {
      const saved = await queueRemovedCopies(
        persistence.saveHydratedAttachment,
      )(execSql, input);
      if (!saved) queued.add(input.attachment.storageKey);
      return saved;
    },
  };
}
