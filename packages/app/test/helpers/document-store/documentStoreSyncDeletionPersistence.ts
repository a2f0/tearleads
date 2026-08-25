import type {
  DocumentRecord,
  DocumentsPersistence,
} from "@symcrypt/client-sdk";

function sameDocumentSecurityIdentity(
  current: DocumentRecord | null,
  expected: DocumentRecord,
): boolean {
  return (
    current !== null &&
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.accessEpoch === expected.accessEpoch &&
    (current.accessStateHash ?? null) === (expected.accessStateHash ?? null) &&
    (current.effectiveAccessLevel ?? null) ===
      (expected.effectiveAccessLevel ?? null) &&
    (current.contentKeyBundle ?? null) ===
      (expected.contentKeyBundle ?? null) &&
    (current.documentKekTargets ?? null) ===
      (expected.documentKekTargets ?? null) &&
    (current.documentManifestBundle ?? null) ===
      (expected.documentManifestBundle ?? null)
  );
}

export function createMemoryDocumentDeletionPersistence<StateSnapshot>(input: {
  deleteSideRows: (localId: string) => void;
  getDocument: () => DocumentRecord | null;
  restore: (snapshot: StateSnapshot) => void;
  setDocument: (document: DocumentRecord | null) => void;
  snapshot: () => StateSnapshot;
}): Pick<DocumentsPersistence, "deleteDocument" | "deleteDocumentIfMatches"> {
  return {
    async deleteDocument(_execSql, localId) {
      if (input.getDocument()?.id === localId) {
        input.setDocument(null);
      }
      input.deleteSideRows(localId);
    },
    async deleteDocumentIfMatches(
      execSql,
      expectedRecord,
      deleteClientProjection,
    ) {
      if (!sameDocumentSecurityIdentity(input.getDocument(), expectedRecord)) {
        return false;
      }
      const previous = input.snapshot();
      try {
        input.setDocument(null);
        input.deleteSideRows(expectedRecord.id);
        await deleteClientProjection(execSql);
        return true;
      } catch (error) {
        input.restore(previous);
        throw error;
      }
    },
  };
}
